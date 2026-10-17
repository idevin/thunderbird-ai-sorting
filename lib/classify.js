import { classifyHeuristic } from "./heuristic.js";
import { categoryFromModel, complete, redact } from "./providers.js";
import {
  activeKey,
  consumeAiSlot,
  loadSettings,
  rememberCategory,
  seenCategory,
} from "./settings.js";
import { applyCategory } from "./tags.js";
import { emailsIn, headerValue, messageText } from "./text.js";

const DECISIONS = new Set(["important", "newsletters", "social", "other"]);

const CLASSIFY_SYSTEM = [
  "Classify one email into exactly one category: important, newsletters, social, or other.",
  "important: a person wrote something the recipient should see.",
  "newsletters: mailing lists, marketing, receipts, and automated notifications.",
  "social: notifications from social networks.",
  "other: anything else.",
  'Reply with JSON only, in the form {"category":"important"}.',
].join(" ");

export function emptyCounts() {
  return {
    important: 0,
    newsletters: 0,
    social: 0,
    other: 0,
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
  if ((result.outcome === "sorted" || result.outcome === "cached") && counts[result.category] != null) {
    counts[result.category] += 1;
    return;
  }
  if (counts[result.outcome] != null) {
    counts[result.outcome] += 1;
  }
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
    if (DECISIONS.has(cached)) {
      await applyCategory(message.id, cached);
      return { outcome: "cached", category: cached, source: "cache" };
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
    decision = { category: "important", confident: true };
  }

  let category = decision.category;
  let source = decision.confident ? "rules" : null;

  if (!decision.confident) {
    if (!allowAi || !activeKey(settings)) {
      return { outcome: "undecided", category: null, source: null };
    }
    if (!(await consumeAiSlot())) {
      return { outcome: "capped", category: null, source: null };
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
    category = categoryFromModel(raw);
    source = "ai";
  }

  await applyCategory(message.id, category);
  if (message.headerMessageId && DECISIONS.has(category)) {
    await rememberCategory(message.headerMessageId, category);
  }
  return { outcome: "sorted", category, source };
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
