import { explain } from "../lib/explain.js";
import { isInboxFolder } from "../lib/folders.js";

const categoryEl = document.querySelector("#category");
const summaryEl = document.querySelector("#summary");
const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const buttons = [...document.querySelectorAll("button")];

let messageId = null;
let busy = false;

function showError(error) {
  errorEl.hidden = !error;
  errorEl.textContent = error ? explain(error) : "";
}

function setBusy(next) {
  busy = next;
  for (const button of buttons) {
    button.disabled = busy || messageId == null;
  }
  if (busy) {
    statusEl.textContent = browser.i18n.getMessage("working");
  }
}

function folderLabel(message) {
  const folder = message && message.folder;
  if (!folder || isInboxFolder(folder)) {
    return "Inbox";
  }
  return folder.name || "Inbox";
}

async function displayedMessage() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tab && tab.id;
  if (typeof browser.messageDisplay.getDisplayedMessage === "function") {
    return browser.messageDisplay.getDisplayedMessage(tabId);
  }
  const messages = await browser.messageDisplay.getDisplayedMessages(tabId);
  return messages && messages[0] ? messages[0] : null;
}

function showOutcome(result) {
  if (result.outcome === "capped") {
    statusEl.textContent = browser.i18n.getMessage("cappedNote", "1");
    return;
  }
  if (result.outcome === "undecided") {
    categoryEl.textContent = "Inbox";
    statusEl.textContent = browser.i18n.getMessage("undecidedNote", "1");
    return;
  }
  if (result.outcome === "skipped") {
    statusEl.textContent = browser.i18n.getMessage("skippedNote", "1");
    return;
  }
  statusEl.textContent = "";
  categoryEl.textContent = result.service || "Inbox";
}

async function run(task) {
  if (messageId == null || busy) {
    return;
  }
  showError(null);
  setBusy(true);
  try {
    await task();
  } catch (error) {
    statusEl.textContent = "";
    showError(error);
  } finally {
    setBusy(false);
  }
}

document.querySelector("#sort").addEventListener("click", () => {
  run(async () => {
    const result = await browser.runtime.sendMessage({ type: "classify-one", messageId });
    showOutcome(result);
  });
});

document.querySelector("#summarize").addEventListener("click", () => {
  run(async () => {
    const result = await browser.runtime.sendMessage({ type: "summarize", messageId });
    summaryEl.hidden = false;
    summaryEl.textContent = result.text;
    statusEl.textContent = "";
  });
});

document.querySelector("#reply").addEventListener("click", () => {
  run(async () => {
    await browser.runtime.sendMessage({
      type: "draft-reply",
      messageId,
      instruction: browser.i18n.getMessage("defaultReplyInstruction"),
    });
    statusEl.textContent = browser.i18n.getMessage("replyOpened");
  });
});

displayedMessage()
  .then(async message => {
    if (!message) {
      categoryEl.textContent = browser.i18n.getMessage("errorNoMessage");
      setBusy(false);
      return;
    }
    messageId = message.id;
    categoryEl.textContent = folderLabel(message);
    setBusy(false);
  })
  .catch(error => {
    categoryEl.textContent = browser.i18n.getMessage("errorNoMessage");
    showError(error);
    setBusy(false);
  });
