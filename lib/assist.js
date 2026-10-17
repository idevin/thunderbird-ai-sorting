import { complete } from "./providers.js";
import { activeKey, loadSettings } from "./settings.js";
import { headerValue, messageText, replyHtml } from "./text.js";
import {
  clipThread,
  extractMessageIds,
  formatThread,
  normalizeMessageId,
  normalizeSubject,
  threadHasText,
} from "./thread.js";

const SUMMARY_SYSTEM = [
  "Summarize this email thread for the person reading it.",
  "Use the language of the thread.",
  "Write the section headings in that same language.",
  "Use three short sections: Decisions, Open questions, Next steps.",
  "If a section has nothing to report, write None.",
  "Do not invent facts.",
].join(" ");

const REPLY_SYSTEM = [
  "You draft an email reply for the user.",
  "Use the language of the incoming mail unless the instruction specifies a language.",
  "Return only the reply text.",
  "Do not include a subject line.",
  "Do not quote the original message.",
  "The program places your text above the existing draft, so do not repeat text that is already there.",
].join(" ");

async function queryMessages(queryInfo) {
  try {
    const page = await browser.messages.query(queryInfo);
    const messages = page.messages || [];
    if (page.id) {
      browser.messages.abortList(page.id).catch(() => {});
    }
    return messages;
  } catch {
    return [];
  }
}

async function threadEntries(messageId) {
  const message = await browser.messages.get(messageId);
  const full = await browser.messages.getFull(message.id);
  const headers = full.headers || {};
  const byId = new Map([[message.id, message]]);
  const folderId = message.folder && message.folder.id;
  const subject = normalizeSubject(message.subject);

  if (folderId && subject) {
    const found = await queryMessages({
      folderId,
      subject,
      messagesPerPage: 40,
      autoPaginationTimeout: 1500,
    });
    for (const candidate of found) {
      if (normalizeSubject(candidate.subject) === subject) {
        byId.set(candidate.id, candidate);
      }
    }
  }

  const ownId = normalizeMessageId(message.headerMessageId || headerValue(headers, "message-id"));
  const referenced = extractMessageIds(
    `${headerValue(headers, "references")} ${headerValue(headers, "in-reply-to")}`
  ).filter(id => id && id !== ownId);

  if (folderId) {
    for (const headerId of referenced.slice(0, 15)) {
      const found = await queryMessages({
        folderId,
        headerMessageId: headerId,
        messagesPerPage: 2,
        autoPaginationTimeout: 1000,
      });
      for (const candidate of found) {
        byId.set(candidate.id, candidate);
      }
    }
  }

  const entries = [];
  for (const candidate of byId.values()) {
    let body = "";
    if (candidate.id === message.id) {
      body = messageText(full);
    } else {
      try {
        body = messageText(await browser.messages.getFull(candidate.id));
      } catch {
        body = "";
      }
    }
    const parsed = candidate.date ? new Date(candidate.date).getTime() : 0;
    const date = Number.isFinite(parsed) ? parsed : 0;
    entries.push({
      author: candidate.author || "",
      subject: candidate.subject || "",
      date,
      dateLabel: date ? new Date(date).toISOString() : "",
      body,
    });
  }
  return clipThread(entries);
}

function instructionText(instruction) {
  const text = String(instruction || "").trim().slice(0, 2000);
  return text || "Write a helpful reply.";
}

async function ask(settings, system, user, temperature) {
  return complete({
    provider: settings.provider,
    apiKey: activeKey(settings),
    model: settings.models[settings.provider],
    system,
    user,
    temperature,
  });
}

async function insertDraft(tabId, text) {
  let lastError = new Error("no-compose");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const details = await browser.compose.getComposeDetails(tabId);
      if (details.isPlainText) {
        const existing = details.plainTextBody || "";
        await browser.compose.setComposeDetails(tabId, {
          plainTextBody: existing ? `${text}\n\n${existing}` : text,
        });
      } else {
        await browser.compose.setComposeDetails(tabId, {
          body: `${replyHtml(text)}${details.body || ""}`,
        });
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function summarizeMessage(messageId) {
  const settings = await loadSettings();
  const entries = await threadEntries(messageId);
  if (!threadHasText(entries)) {
    throw new Error("summary-empty");
  }
  return ask(settings, SUMMARY_SYSTEM, formatThread(entries), 0.2);
}

export async function draftReply(messageId, instruction) {
  const settings = await loadSettings();
  const entries = await threadEntries(messageId);
  const draft = await ask(
    settings,
    REPLY_SYSTEM,
    `Instruction: ${instructionText(instruction)}\n\nThread:\n${formatThread(entries)}`,
    0.4
  );
  const tab = await browser.compose.beginReply(messageId, "reply");
  await insertDraft(tab.id, draft.trim());
}

export async function draftInCompose(tabId, instruction) {
  const settings = await loadSettings();
  const details = await browser.compose.getComposeDetails(tabId);
  const current = details.isPlainText ? details.plainTextBody || "" : details.body || "";
  const draft = await ask(
    settings,
    REPLY_SYSTEM,
    `Instruction: ${instructionText(instruction)}\n\nCurrent draft:\n${String(current).slice(0, 12000)}`,
    0.4
  );
  await insertDraft(tabId, draft.trim());
}
