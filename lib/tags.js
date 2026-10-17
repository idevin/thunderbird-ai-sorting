export const TAGS = {
  important: { key: "ai-important", color: "#D93025", nameKey: "tagImportant" },
  newsletters: { key: "ai-newsletters", color: "#188038", nameKey: "tagNewsletters" },
  social: { key: "ai-social", color: "#1A73E8", nameKey: "tagSocial" },
};

let resolved = null;

export function resolveTagKeys(existing, names) {
  const byName = new Map();
  for (const tag of existing || []) {
    const label = String(tag.tag || "").trim().toLowerCase();
    if (label && !byName.has(label)) {
      byName.set(label, tag.key);
    }
  }
  const keys = {};
  for (const [category, spec] of Object.entries(TAGS)) {
    const wanted = String((names && names[category]) || "").trim().toLowerCase();
    keys[category] = (wanted && byName.get(wanted)) || spec.key;
  }
  return keys;
}

export function categoryFromTags(tags) {
  const present = new Set(tags || []);
  const categories = Object.keys(TAGS);
  if (resolved) {
    for (const category of categories) {
      if (present.has(resolved[category])) {
        return category;
      }
    }
  }
  for (const category of categories) {
    if (present.has(TAGS[category].key)) {
      return category;
    }
  }
  return null;
}

function managedKeys() {
  const keys = new Set(Object.values(TAGS).map(spec => spec.key));
  if (resolved) {
    for (const key of Object.values(resolved)) {
      keys.add(key);
    }
  }
  return keys;
}

let ready = null;

async function createTags() {
  const existing = await browser.messages.tags.list();
  const names = {};
  for (const [category, spec] of Object.entries(TAGS)) {
    names[category] = browser.i18n.getMessage(spec.nameKey) || category;
  }
  const keys = resolveTagKeys(existing, names);
  const byKey = new Map(existing.map(tag => [tag.key, tag]));
  const usedNames = new Set(existing.map(tag => String(tag.tag || "").trim().toLowerCase()));
  for (const [category, spec] of Object.entries(TAGS)) {
    const key = keys[category];
    const preferred = names[category];
    const current = byKey.get(key);
    if (!current) {
      await browser.messages.tags.create(key, preferred, spec.color);
      continue;
    }
    if (key !== spec.key) {
      continue;
    }
    const sameName = String(current.tag || "").trim().toLowerCase() === preferred.trim().toLowerCase();
    const sameColor = String(current.color || "").toLowerCase() === spec.color.toLowerCase();
    if (!sameName && !usedNames.has(preferred.trim().toLowerCase())) {
      await browser.messages.tags.update(key, { tag: preferred, color: spec.color });
      continue;
    }
    if (!sameColor) {
      await browser.messages.tags.update(key, { color: spec.color });
    }
  }
  resolved = keys;
}

export function ensureTags() {
  if (!ready) {
    ready = createTags().catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

export async function applyCategory(messageId, category) {
  await ensureTags();
  const message = await browser.messages.get(messageId);
  const ours = managedKeys();
  const tags = (message.tags || []).filter(tag => !ours.has(tag));
  if (category && category !== "other" && resolved[category]) {
    tags.push(resolved[category]);
  }
  await browser.messages.update(messageId, { tags });
}
