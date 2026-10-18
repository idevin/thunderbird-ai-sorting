import { explain } from "../lib/explain.js";

const STYLE_KEY = "replyStyle";

const STYLES = {
  polite: "Be courteous, warm, and brief.",
  funny: "Be playful and lightly funny, without mocking the other person.",
  sad: "Sound gently sad and sincere, without melodrama.",
  tricky: "Be clever and a little sly, while staying honest.",
  angry: "Sound firmly angry and direct, without insults or threats.",
  philosophic: "Add a short philosophical reflection, then the practical point.",
  buddha: "Write with calm, compassion, and non-attachment, in the spirit of the Buddha. Stay concrete.",
  formal: "Use a formal, professional tone.",
  warm: "Sound warm, friendly, and personal.",
  brief: "Use as few words as possible.",
  dry: "Be understated and dry, with a straight face.",
};

const ACTIONS = {
  answer: "Write a reply to this message.",
  decline: "Decline this request.",
};

const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const styleEl = document.querySelector("#style");
const controls = [...document.querySelectorAll("button, select")];

function showError(error) {
  errorEl.hidden = !error;
  errorEl.textContent = error ? explain(error) : "";
}

function selectedStyle() {
  return Object.prototype.hasOwnProperty.call(STYLES, styleEl.value) ? styleEl.value : "polite";
}

function instructionFor(action) {
  return `${ACTIONS[action]} ${STYLES[selectedStyle()]}`;
}

function setBusy(busy) {
  for (const control of controls) {
    control.disabled = busy;
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

styleEl.addEventListener("change", () => {
  browser.storage.local.set({ [STYLE_KEY]: selectedStyle() }).catch(() => {});
});

document.querySelector("#answer").addEventListener("click", () => {
  run(instructionFor("answer"));
});

document.querySelector("#decline").addEventListener("click", () => {
  run(instructionFor("decline"));
});

browser.storage.local.get(STYLE_KEY).then(stored => {
  const saved = stored && stored[STYLE_KEY];
  if (Object.prototype.hasOwnProperty.call(STYLES, saved)) {
    styleEl.value = saved;
  }
}).catch(() => {});
