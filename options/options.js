import { explain } from "../lib/explain.js";
import { complete } from "../lib/providers.js";
import { loadSettings, saveSettings } from "../lib/settings.js";

const providerEl = document.querySelector("#provider");
const keyEl = document.querySelector("#api-key");
const modelEl = document.querySelector("#model");
const autoEl = document.querySelector("#auto");
const useAiEl = document.querySelector("#use-ai");
const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");

let keys = { openai: "", gemini: "" };
let models = { openai: "", gemini: "" };
let provider = "openai";
let loaded = false;

function showError(error) {
  errorEl.hidden = !error;
  errorEl.textContent = error ? explain(error) : "";
}

function rememberField() {
  keys[provider] = keyEl.value;
  models[provider] = modelEl.value;
}

function showProvider(next) {
  provider = next;
  providerEl.value = next;
  keyEl.value = keys[next] || "";
  modelEl.value = models[next] || "";
  modelEl.placeholder = "";
}

function formSettings() {
  rememberField();
  return {
    provider,
    keys,
    models,
    autoClassify: autoEl.checked,
    useAiForUncertain: useAiEl.checked,
  };
}

async function persist() {
  const saved = await saveSettings(formSettings());
  keys = saved.keys;
  models = saved.models;
  showProvider(saved.provider);
  autoEl.checked = saved.autoClassify;
  useAiEl.checked = saved.useAiForUncertain;
  return saved;
}

providerEl.addEventListener("change", () => {
  rememberField();
  showProvider(providerEl.value);
});

async function persistQuiet() {
  if (!loaded) {
    return;
  }
  showError(null);
  try {
    await persist();
  } catch (error) {
    showError(error);
  }
}

autoEl.addEventListener("change", persistQuiet);
useAiEl.addEventListener("change", persistQuiet);

document.querySelector("#save").addEventListener("click", async () => {
  showError(null);
  statusEl.textContent = "";
  try {
    await persist();
    statusEl.textContent = browser.i18n.getMessage("saved");
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#test").addEventListener("click", async () => {
  showError(null);
  statusEl.textContent = browser.i18n.getMessage("working");
  document.querySelector("#test").disabled = true;
  try {
    const saved = await persist();
    await complete({
      provider: saved.provider,
      apiKey: saved.keys[saved.provider],
      model: saved.models[saved.provider],
      system: "Reply with the single word ok.",
      user: "ping",
      temperature: 0,
    });
    statusEl.textContent = browser.i18n.getMessage("testOk");
  } catch (error) {
    statusEl.textContent = "";
    showError(error);
  } finally {
    document.querySelector("#test").disabled = false;
  }
});

loadSettings()
  .then(saved => {
    keys = saved.keys;
    models = saved.models;
    autoEl.checked = saved.autoClassify;
    useAiEl.checked = saved.useAiForUncertain;
    showProvider(saved.provider);
    loaded = true;
  })
  .catch(error => {
    showError(error);
  });
