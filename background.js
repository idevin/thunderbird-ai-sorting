import { draftInCompose, draftReply, summarizeMessage } from "./lib/assist.js";
import { classifyIds, classifyMessage, loadAccountEmails } from "./lib/classify.js";
import { redact } from "./lib/providers.js";
import { loadSettings } from "./lib/settings.js";

async function eachMessage(list) {
  const messages = [];
  let page = list;
  while (page) {
    messages.push(...(page.messages || []));
    if (!page.id) {
      break;
    }
    page = await browser.messages.continueList(page.id);
  }
  return messages;
}

browser.messages.onNewMailReceived.addListener(async (folder, list) => {
  if (!folder || folder.type !== "inbox") {
    return;
  }
  const settings = await loadSettings();
  if (!settings.autoClassify) {
    return;
  }
  const messages = await eachMessage(list);
  const accountEmails = await loadAccountEmails();
  const bookCache = new Map();
  for (const message of messages) {
    try {
      await classifyMessage(message, {
        force: false,
        allowAi: settings.useAiForUncertain,
        settings,
        accountEmails,
        bookCache,
      });
    } catch (error) {
      console.error("AI Sorting", redact(error && error.message));
    }
  }
});

function dispatch(message) {
  switch (message.type) {
    case "classify-one":
      return classifyMessage(message.messageId, { force: true });
    case "classify-many":
      return classifyIds(Array.isArray(message.messageIds) ? message.messageIds : [], {
        force: false,
      });
    case "summarize":
      return summarizeMessage(message.messageId).then(text => ({ text }));
    case "draft-reply":
      return draftReply(message.messageId, message.instruction).then(() => ({ ok: true }));
    case "draft-compose":
      return draftInCompose(message.tabId, message.instruction).then(() => ({ ok: true }));
    default:
      return undefined;
  }
}

// Drafting opens another window and can close the popup before it finishes.
// The listener keeps the work in this event page.
browser.runtime.onMessage.addListener((message, sender) => {
  if (!sender || sender.id !== browser.runtime.id || !message || typeof message.type !== "string") {
    return undefined;
  }
  return dispatch(message);
});
