import { PROVIDERS } from "./providers.js";
import { normalizeMessageId } from "./thread.js";

export const AI_HOURLY_CAP = 40;
const MAX_SEEN = 400;

export const DEFAULT_SETTINGS = {
  provider: "openai",
  models: { openai: "", openrouter: "", gemini: "", grok: "" },
  keys: { openai: "", openrouter: "", gemini: "", grok: "" },
  autoClassify: true,
  useAiForUncertain: true,
};

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function providerMap(value, max) {
  const incoming = value && typeof value === "object" ? value : {};
  const cleaned = { openai: "", openrouter: "", gemini: "", grok: "" };
  for (const id of Object.keys(cleaned)) {
    cleaned[id] = cleanText(incoming[id], max);
  }
  return cleaned;
}

export function normalizeSettings(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, source.provider)
    ? source.provider
    : "openai";
  return {
    provider,
    models: providerMap(source.models, 120),
    keys: providerMap(source.keys, 400),
    autoClassify: source.autoClassify !== false,
    useAiForUncertain: source.useAiForUncertain !== false,
  };
}

export async function loadSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await browser.storage.local.set(normalized);
  return normalized;
}

export function activeModel(settings) {
  const custom = settings.models[settings.provider];
  return custom || PROVIDERS[settings.provider].defaultModel;
}

export function activeKey(settings) {
  return settings.keys[settings.provider] || "";
}

export async function consumeAiSlot() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const stored = await browser.storage.local.get({ aiWindowStart: 0, aiWindowCount: 0 });
  let start = Number(stored.aiWindowStart) || 0;
  let count = Number(stored.aiWindowCount) || 0;
  if (!start || now - start >= hour) {
    start = now;
    count = 0;
  }
  if (count >= AI_HOURLY_CAP) {
    return false;
  }
  await browser.storage.local.set({ aiWindowStart: start, aiWindowCount: count + 1 });
  return true;
}

export async function seenCategory(headerId) {
  const id = normalizeMessageId(headerId);
  if (!id) {
    return undefined;
  }
  const stored = await browser.storage.local.get({ seen: {} });
  const seen = stored.seen && typeof stored.seen === "object" ? stored.seen : {};
  return Object.prototype.hasOwnProperty.call(seen, id) ? seen[id] : undefined;
}

export async function rememberCategory(headerId, category) {
  const id = normalizeMessageId(headerId);
  if (!id) {
    return;
  }
  const stored = await browser.storage.local.get({ seen: {}, seenOrder: [] });
  const seen = stored.seen && typeof stored.seen === "object" ? { ...stored.seen } : {};
  const order = Array.isArray(stored.seenOrder) ? stored.seenOrder.filter(item => item !== id) : [];
  order.push(id);
  seen[id] = category;
  while (order.length > MAX_SEEN) {
    const old = order.shift();
    delete seen[old];
  }
  await browser.storage.local.set({ seen, seenOrder: order });
}
