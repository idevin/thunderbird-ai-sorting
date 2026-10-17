import { fileMessage } from "./folders.js";
import { classifyHeuristic } from "./heuristic.js";
import { complete, redact } from "./providers.js";
import { sanitizeFolderName, serviceFromModel } from "./services.js";
import {
  activeKey,
  consumeAiSlot,
  loadSettings,
  rememberCategory,
  seenCategory,
} from "./settings.js";
import { emailsIn, headerValue, messageText } from "./text.js";

const LEGACY = new Set(["important", "newsletters", "social", "other"]);

const CLASSIFY_SYSTEM = [
  "Name the company or service that sent this email.",
  "Use a short English name such as LinkedIn, Google, or GitHub.",
  "If a person wrote the message, use an empty service.",
  'Reply with JSON only, in the form {"service":"GitHub"} or {"service":""}.',
].join(" ");

export function emptyCounts() {
  return {
    folders: {},
    inbox: 0,
    undecided: 0,
    capped: 0,
    skipped: 0,
    failed: 0,
  };
}

export async function loadAccountEmails() {
  const accounts = await browser.accounts.list();
  const emails = [];
  for (const account of accounts || []) {
    for (const identity of account.identities || []) {
      if (identity && identity.email) {
        emails.push(identity.email.toLowerCase());
      }
    }
  }
  return [...new Set(emails)];
}

async function authorInBook(author, cache) {
  const [email] = emailsIn(author);
  if (!email) {
    return false;
  }
  if (cache.has(email)) {
    return cache.get(email);
  }
  let found = false;
  try {
    const contacts = await browser.contacts.quickSearch({
      searchString: email,
      includeRemote: false,
    });
    found = (contacts || []).some(contact => {
      const properties = contact && contact.properties ? contact.properties : contact;
      return emailsIn(JSON.stringify(properties)).includes(email);
    });
  } catch {
    found = false;
  }
  cache.set(email, found);
  return found;
}

function tally(counts, result) {
  if (result.outcome === "sorted" && result.service) {
    counts.folders[result.service] = (counts.folders[result.service] || 0) + 1;
    return;
  }
  if (result.outcome === "inbox") {
    counts.inbox += 1;
    return;
  }
  if (counts[result.outcome] != null) {
    counts[result.outcome] += 1;
  }
}

async function keep(message, service, source) {
  const name = sanitizeFolderName(service);
  if (message.headerMessageId) {
    await rememberCategory(message.headerMessageId, name);
  }
  if (!name) {
    return { outcome: "inbox", service: "", source };
  }
  await fileMessage(message, name);
  return { outcome: "sorted", service: name, source };
}

export async function classifyMessage(messageOrId, options = {}) {
  const settings = options.settings || (await loadSettings());
  const force = options.force === true;
  const allowAi = options.allowAi !== false && settings.useAiForUncertain;
  const message =
    messageOrId && typeof messageOrId === "object"
      ? messageOrId
      : await browser.messages.get(messageOrId);

  if (!message || message.junk || message.external) {
    return { outcome: "skipped", category: null, source: null };
  }

  if (!force && message.headerMessageId) {
    const cached = await seenCategory(message.headerMessageId);
    if (typeof cached === "string" && !LEGACY.has(cached)) {
      return keep(message, cached, "cache");
    }
  }

  let full = null;
  try {
    full = await browser.messages.getFull(message.id);
  } catch (error) {
    console.error("AI Sorting", redact(error && error.message));
  }
  const headers = (full && full.headers) || {};
  const author = message.author || headerValue(headers, "from");
  const to = emailsIn([...(message.recipients || []), headerValue(headers, "to")]);
  const cc = emailsIn([...(message.ccList || []), headerValue(headers, "cc")]);
  const accountEmails = options.accountEmails || (await loadAccountEmails());
  const bookCache = options.bookCache || new Map();

  let decision = classifyHeuristic({
    headers,
    author,
    to,
    cc,
    accountEmails,
    inAddressBook: false,
  });
  if (!decision.confident && (await authorInBook(author, bookCache))) {
    decision = { service: "", confident: true };
  }

  let service = decision.service;
  let source = decision.confident ? "rules" : null;

  if (!decision.confident) {
    if (!allowAi || !activeKey(settings)) {
      return { outcome: "undecided", service: null, source: null };
    }
    if (!(await consumeAiSlot())) {
      return { outcome: "capped", service: null, source: null };
    }
    const snippet = full ? messageText(full).slice(0, 2000) : "";
    const raw = await complete({
      provider: settings.provider,
      apiKey: activeKey(settings),
      model: settings.models[settings.provider],
      system: CLASSIFY_SYSTEM,
      user: `From: ${author}\nTo: ${to.join(", ")}\nSubject: ${message.subject || ""}\n\n${snippet}`,
      temperature: 0,
    });
    service = serviceFromModel(raw);
    source = "ai";
  }

  return keep(message, service, source);
}

export async function classifyIds(ids, { force = false } = {}) {
  const settings = await loadSettings();
  const accountEmails = await loadAccountEmails();
  const bookCache = new Map();
  const counts = emptyCounts();
  const unique = [...new Set((ids || []).filter(id => Number.isInteger(id)))].slice(0, 50);
  for (const id of unique) {
    try {
      const result = await classifyMessage(id, {
        force,
        allowAi: settings.useAiForUncertain,
        settings,
        accountEmails,
        bookCache,
      });
      tally(counts, result);
    } catch (error) {
      counts.failed += 1;
      const detail = redact(error && error.message);
      if (!counts.error) {
        counts.error = detail;
      }
      console.error("AI Sorting", detail);
    }
  }
  return counts;
}
