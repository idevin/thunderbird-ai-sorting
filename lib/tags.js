export const TAGS = {
  important: { key: "ai-important", color: "#D93025", nameKey: "tagImportant" },
  newsletters: { key: "ai-newsletters", color: "#188038", nameKey: "tagNewsletters" },
  social: { key: "ai-social", color: "#1A73E8", nameKey: "tagSocial" },
};

export const TAG_KEYS = new Set(Object.values(TAGS).map(tag => tag.key));

export function categoryFromTags(tags) {
  const keys = new Set(tags || []);
  for (const [category, spec] of Object.entries(TAGS)) {
    if (keys.has(spec.key)) {
      return category;
    }
  }
  return null;
}

let ready = null;

async function createTags() {
  const existing = await browser.messages.tags.list();
  const byKey = new Map(existing.map(tag => [tag.key, tag]));
  for (const spec of Object.values(TAGS)) {
    const name = browser.i18n.getMessage(spec.nameKey);
    const current = byKey.get(spec.key);
    if (!current) {
      try {
        await browser.messages.tags.create(spec.key, name, spec.color);
      } catch {
        await browser.messages.tags.update(spec.key, { tag: name, color: spec.color });
      }
      continue;
    }
    const sameName = current.tag === name;
    const sameColor = String(current.color || "").toLowerCase() === spec.color.toLowerCase();
    if (!sameName || !sameColor) {
      await browser.messages.tags.update(spec.key, { tag: name, color: spec.color });
    }
  }
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
  const tags = (message.tags || []).filter(tag => !TAG_KEYS.has(tag));
  if (category && category !== "other" && TAGS[category]) {
    tags.push(TAGS[category].key);
  }
  await browser.messages.update(messageId, { tags });
}
