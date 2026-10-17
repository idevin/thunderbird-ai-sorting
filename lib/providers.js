export const PROVIDERS = {
  openai: {
    id: "openai",
    style: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4.1-mini",
  },
  gemini: {
    id: "gemini",
    style: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-3.8-flash",
  },
};

const CATEGORIES = new Set(["important", "newsletters", "social", "other"]);

function readErrorMessage(data) {
  if (typeof data === "string") {
    return data;
  }
  if (!data || typeof data !== "object") {
    return "";
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }
  const error = data.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

function parseErrorMessage(raw) {
  try {
    return readErrorMessage(JSON.parse(raw));
  } catch {
    return "";
  }
}

function looseErrorMessage(raw) {
  const match = String(raw || "").match(/"message"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) {
    return "";
  }
  return match[1]
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export function providerErrorText(body) {
  let raw = String(body || "").trim().replace(/^provider:/, "");
  const status = raw.match(/^\d{3}:([\s\S]*)$/);
  if (status) {
    raw = status[1].trim();
  }
  if (!raw) {
    return "";
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const sliced = start !== -1 && end > start ? raw.slice(start, end + 1) : "";
  const message = parseErrorMessage(raw) || (sliced ? parseErrorMessage(sliced) : "") || looseErrorMessage(raw);
  const text = message || (raw.startsWith("{") || raw.startsWith("[") ? "" : raw);
  return text.replace(/\s+/g, " ").trim();
}

export function redact(text, secret) {
  let output = String(text || "")
    .replace(/key=[^&\s]+/gi, "key=…")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-…")
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, "AIza…");
  const hidden = String(secret || "");
  if (hidden.length >= 8) {
    output = output.split(hidden).join("…");
  }
  return output.slice(0, 400);
}

export function parseOpenAiContent(payload) {
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(part => (part && typeof part.text === "string" ? part.text : "")).join("");
  }
  return "";
}

export function parseGeminiContent(payload) {
  const parts = payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content
    ? payload.candidates[0].content.parts
    : [];
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts.map(part => (part && typeof part.text === "string" ? part.text : "")).join("");
}

export function parseModelJson(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no-json");
  }
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    throw new Error("no-json");
  }
}

export function categoryFromModel(text) {
  const data = parseModelJson(text);
  const category = String(data.category || "").trim().toLowerCase();
  if (!CATEGORIES.has(category)) {
    throw new Error("unknown-category");
  }
  return category;
}

async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error("network");
  }
}

async function readError(response, secret) {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  const detail = redact(providerErrorText(body), secret);
  throw new Error(detail ? `provider:${response.status}:${detail}` : `provider:${response.status}`);
}

async function completeOpenAi({ spec, apiKey, model, system, user, temperature }) {
  const response = await request(spec.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    await readError(response, apiKey);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("empty");
  }
  const text = parseOpenAiContent(payload).trim();
  if (!text) {
    throw new Error("empty");
  }
  return text;
}

async function completeGemini({ spec, apiKey, model, system, user, temperature }) {
  const url = `${spec.endpoint}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature },
    }),
  });
  if (!response.ok) {
    await readError(response, apiKey);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("empty");
  }
  const text = parseGeminiContent(payload).trim();
  if (!text) {
    throw new Error("empty");
  }
  return text;
}

export async function complete({ provider, apiKey, model, system, user, temperature = 0.2 }) {
  const spec = PROVIDERS[provider];
  if (!spec) {
    throw new Error("missing-key");
  }
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("missing-key");
  }
  const chosen = String(model || "").trim() || spec.defaultModel;
  const input = {
    spec,
    apiKey: key,
    model: chosen,
    system: String(system || ""),
    user: String(user || ""),
    temperature,
  };
  if (spec.style === "gemini") {
    return completeGemini(input);
  }
  return completeOpenAi(input);
}
