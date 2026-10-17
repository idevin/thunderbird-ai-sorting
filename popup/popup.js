import { explain } from "../lib/explain.js";

const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const sortButton = document.querySelector("#sort");

let timer = 0;

function showError(error) {
  errorEl.hidden = !error;
  errorEl.textContent = error ? explain(error) : "";
}

function isRunning(status) {
  return status.phase === "listing" || status.phase === "sorting";
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

function reportLines(counts) {
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
      lines.push(explain(new Error(counts.error)));
    }
  }
  return lines;
}

function render(status) {
  const running = isRunning(status);
  sortButton.disabled = running;
  statusEl.setAttribute("aria-busy", running ? "true" : "false");
  if (!status || status.phase === "idle") {
    statusEl.textContent = "";
    showError(null);
    return;
  }
  if (status.phase === "error") {
    showError(new Error(status.fatal || "empty"));
  } else {
    showError(null);
  }
  const summary = reportLines(status.counts || {});
  const lines = [];
  if (status.phase === "listing") {
    lines.push(browser.i18n.getMessage("sortingListing"));
  } else if (
    status.phase === "sorting" ||
    (status.phase === "error" && status.processed > 0) ||
    (status.phase === "done" && !summary.length)
  ) {
    lines.push(browser.i18n.getMessage("sortingProgress", [String(status.processed), String(status.total)]));
  }
  lines.push(...summary);
  statusEl.textContent = lines.filter(Boolean).join(" ");
}

function stopWatch() {
  if (!timer) {
    return;
  }
  window.clearInterval(timer);
  timer = 0;
}

async function refresh() {
  try {
    const status = await browser.runtime.sendMessage({ type: "sort-status" });
    render(status);
    if (!isRunning(status)) {
      stopWatch();
    }
    return status;
  } catch (error) {
    showError(error);
    return null;
  }
}

function watch() {
  if (timer) {
    return;
  }
  timer = window.setInterval(() => {
    refresh();
  }, 400);
}

sortButton.addEventListener("click", async () => {
  showError(null);
  sortButton.disabled = true;
  try {
    const tab = await currentMailTab();
    if (!tab) {
      throw new Error("no-folder");
    }
    const status = await browser.runtime.sendMessage({ type: "sort-start", tabId: tab.id });
    render(status);
    if (isRunning(status)) {
      watch();
    }
  } catch (error) {
    sortButton.disabled = false;
    showError(error);
  }
});

document.querySelector("#options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

window.addEventListener("pagehide", stopWatch);

refresh().then(status => {
  if (status && isRunning(status)) {
    watch();
  }
});
