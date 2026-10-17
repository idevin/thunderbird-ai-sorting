import { sanitizeFolderName } from "./services.js";

const inboxes = new Map();
const folders = new Map();

async function inboxForAccount(accountId) {
  if (inboxes.has(accountId)) {
    return inboxes.get(accountId);
  }
  const found = await browser.folders.query({ accountId, specialUse: ["inbox"] });
  const inbox = (found || []).find(folder => folder && !folder.isVirtual && !folder.isUnified);
  if (!inbox) {
    throw new Error("no-folder");
  }
  inboxes.set(accountId, inbox);
  return inbox;
}

export async function ensureServiceFolder(accountId, serviceName) {
  const name = sanitizeFolderName(serviceName);
  if (!name) {
    throw new Error("empty");
  }
  const key = `${accountId}\0${name.toLowerCase()}`;
  if (folders.has(key)) {
    return folders.get(key);
  }
  const inbox = await inboxForAccount(accountId);
  const subs = await browser.folders.getSubFolders(inbox.id, false);
  const existing = (subs || []).find(folder => folder.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    folders.set(key, existing.id);
    return existing.id;
  }
  try {
    const created = await browser.folders.create(inbox.id, name);
    folders.set(key, created.id);
    return created.id;
  } catch (error) {
    const again = await browser.folders.getSubFolders(inbox.id, false);
    const raced = (again || []).find(folder => folder.name.toLowerCase() === name.toLowerCase());
    if (!raced) {
      throw error;
    }
    folders.set(key, raced.id);
    return raced.id;
  }
}

export async function fileMessage(message, serviceName) {
  const accountId = message.folder && message.folder.accountId;
  if (!accountId) {
    throw new Error("no-folder");
  }
  const folderId = await ensureServiceFolder(accountId, serviceName);
  const name = sanitizeFolderName(serviceName);
  if (message.folder && message.folder.id === folderId) {
    return { moved: false, service: name };
  }
  await browser.messages.move([message.id], folderId);
  return { moved: true, service: name };
}
