const REPLY_PREFIX = /^(?:re|fw|fwd|aw|sv|vs|antw|tr|ynt|odp|doorst)(?:\[\d+\])?\s*:\s*/i;

export function normalizeSubject(subject) {
  let value = String(subject || "").replace(/\s+/g, " ").trim();
  let previous;
  do {
    previous = value;
    value = value.replace(REPLY_PREFIX, "").trim();
  } while (value !== previous);
  return value;
}

export function normalizeMessageId(value) {
  const match = String(value || "").match(/<[^<>\s]+>/);
  if (match) {
    return match[0].toLowerCase();
  }
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const bare = trimmed.replace(/^<|>$/g, "");
  return bare ? `<${bare}>` : "";
}

export function extractMessageIds(value) {
  const found = String(value || "").match(/<[^<>\s]+>/g) || [];
  return [...new Set(found.map(id => id.toLowerCase()))];
}

export function clipThread(entries, { maxMessages = 15, maxChars = 12000, perMessage = 1000 } = {}) {
  const sorted = [...entries].sort((a, b) => (a.date || 0) - (b.date || 0));
  const recent = sorted.slice(-maxMessages).map(entry => ({
    ...entry,
    body: String(entry.body || "").slice(0, perMessage),
  }));
  let total = recent.reduce((sum, entry) => sum + entry.body.length, 0);
  while (total > maxChars && recent.length > 1) {
    total -= recent[0].body.length;
    recent.shift();
  }
  if (recent.length === 1 && recent[0].body.length > maxChars) {
    recent[0] = { ...recent[0], body: recent[0].body.slice(0, maxChars) };
  }
  return recent;
}

export function threadHasText(entries) {
  return entries.some(entry => String(entry.body || "").trim());
}

export function formatThread(entries) {
  return entries
    .map(entry => {
      const body = String(entry.body || "").trim() || "(no text)";
      return `From: ${entry.author || ""}\nDate: ${entry.dateLabel || ""}\nSubject: ${entry.subject || ""}\n\n${body}`;
    })
    .join("\n\n---\n\n");
}
