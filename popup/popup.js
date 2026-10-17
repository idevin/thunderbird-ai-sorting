import { explain } from "../lib/explain.js";

const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const sortButton = document.querySelector("#sort");

function showError(error) {
  errorEl.hidden = !error;
  errorEl.textContent = error ? explain(error) : "";
}

async function listedIds(list) {
  const ids = [];
  let page = list;
  while (page) {
    for (const message of page.messages || []) {
      ids.push(message.id);
    }
    if (!page.id) {
      break;
    }
    page = await browser.messages.continueList(page.id);
  }
  return ids;
}

async function currentMailTab() {
  try {
    const current = await browser.mailTabs.getCurrent();
    if (current) {
      return current;
    }
  } catch {
    // No mail tab is active in this window.
  }
  const tabs = await browser.mailTabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function targetIds() {
  const tab = await currentMailTab();
  if (!tab) {
    throw new Error("no-folder");
  }
  const selected = await browser.mailTabs.getSelectedMessages(tab.id);
  if ((selected.messages || []).length > 1) {
    return listedIds(selected);
  }
  const folderId = tab.displayedFolder && tab.displayedFolder.id;
  if (!folderId) {
    throw new Error("no-folder");
  }
  return listedIds(await browser.messages.list(folderId));
}

function report(counts) {
  const folders = Object.entries(counts.folders || {}).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const lines = [];
  if (folders.length) {
    lines.push(folders.map(([name, count]) => `${name} ${count}`).join(", ") + ".");
  }
  if (counts.inbox) {
    lines.push(`Left in the inbox: ${counts.inbox}.`);
  }
  if (counts.undecided) {
    lines.push(browser.i18n.getMessage("undecidedNote", String(counts.undecided)));
  }
  if (counts.capped) {
    lines.push(browser.i18n.getMessage("cappedNote", String(counts.capped)));
  }
  if (counts.skipped) {
    lines.push(browser.i18n.getMessage("skippedNote", String(counts.skipped)));
  }
  if (counts.failed) {
    lines.push(browser.i18n.getMessage("failedNote", String(counts.failed)));
    if (counts.error) {
      lines.push(counts.error);
    }
  }
  statusEl.textContent = lines.join(" ");
}

sortButton.addEventListener("click", async () => {
  showError(null);
  sortButton.disabled = true;
  statusEl.textContent = "Sorting every message. This can take a long time.";
  try {
    const messageIds = await targetIds();
    const counts = await browser.runtime.sendMessage({ type: "classify-many", messageIds });
    report(counts);
  } catch (error) {
    statusEl.textContent = "";
    showError(error);
  } finally {
    sortButton.disabled = false;
  }
});

document.querySelector("#options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});
