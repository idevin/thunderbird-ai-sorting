const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") {
    return "";
  }
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) {
      continue;
    }
    const value = headers[key];
    if (Array.isArray(value)) {
      return value.join(" ");
    }
    return value == null ? "" : String(value);
  }
  return "";
}

export function emailsIn(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value || "");
  const found = text.match(EMAIL) || [];
  return [...new Set(found.map(email => email.toLowerCase()))];
}

export function domainOf(email) {
  const at = String(email || "").lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function replyHtml(text) {
  const paragraphs = escapeHtml(text).trim().split(/\n{2,}/);
  return paragraphs
    .map(paragraph => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function walkParts(part, plain, html) {
  if (!part || typeof part !== "object") {
    return;
  }
  if (!part.name && typeof part.body === "string" && part.body.trim()) {
    const type = String(part.contentType || "").toLowerCase();
    const clipped = part.body.length > 20000 ? part.body.slice(0, 20000) : part.body;
    if (type.startsWith("text/html")) {
      html.push(clipped);
    } else if (type.startsWith("text/plain") || (!type && !part.parts)) {
      plain.push(clipped);
    }
  }
  for (const child of part.parts || []) {
    walkParts(child, plain, html);
  }
}

export function messageText(part) {
  const plain = [];
  const html = [];
  walkParts(part, plain, html);
  if (plain.length) {
    return plain.join("\n").trim();
  }
  return html.map(stripHtml).join("\n").trim();
}
