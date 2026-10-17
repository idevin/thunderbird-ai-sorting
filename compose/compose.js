import { explain } from "../lib/explain.js";

const instructionEl = document.querySelector("#instruction");
const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const buttons = [...document.querySelectorAll("button")];

instructionEl.placeholder = browser.i18n.getMessage("instructionPlaceholder");

function showError(error) {
  errorEl.hidden = !error;
  errorEl.textContent = error ? explain(error) : "";
}

function setBusy(busy) {
  for (const button of buttons) {
    button.disabled = busy;
  }
  if (busy) {
    statusEl.textContent = browser.i18n.getMessage("working");
  }
}

async function composeTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      await browser.compose.getComposeDetails(tab.id);
      return tab.id;
    } catch {
      // The popup is not the compose tab.
    }
  }
  const windows = await browser.windows.getAll({
    windowTypes: ["messageCompose"],
    populate: true,
  });
  for (const win of windows) {
    const composeTab = (win.tabs || []).find(item => item.active) || (win.tabs || [])[0];
    if (composeTab) {
      return composeTab.id;
    }
  }
  throw new Error("no-compose");
}

async function run(instruction) {
  showError(null);
  setBusy(true);
  try {
    const tabId = await composeTabId();
    await browser.runtime.sendMessage({ type: "draft-compose", tabId, instruction });
    statusEl.textContent = browser.i18n.getMessage("draftInserted");
  } catch (error) {
    statusEl.textContent = "";
    showError(error);
  } finally {
    setBusy(false);
  }
}

document.querySelector("#insert").addEventListener("click", () => {
  const typed = instructionEl.value.trim();
  run(typed || browser.i18n.getMessage("defaultComposeInstruction"));
});

document.querySelector("#shorter").addEventListener("click", () => {
  run(browser.i18n.getMessage("presetShorterInstruction"));
});

document.querySelector("#decline").addEventListener("click", () => {
  run(browser.i18n.getMessage("presetDeclineInstruction"));
});
