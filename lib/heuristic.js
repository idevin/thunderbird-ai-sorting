import { domainOf, emailsIn, headerValue } from "./text.js";

// List headers beat a social domain. A social domain beats a noreply local-part,
// so noreply@linkedin.com stays Social while noreply@shop.example is a newsletter.
const BULK_LOCAL =
  /^(?:no-?reply|do-?not-?reply|donotreply|newsletter|news|notify|notifications|mailer-daemon|bounce)(?:$|[+._-])/i;

export const SOCIAL_DOMAINS = [
  "facebookmail.com",
  "facebook.com",
  "fb.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "vk.com",
  "vk.ru",
  "vk.team",
  "ok.ru",
  "t.me",
  "telegram.org",
  "discord.com",
  "discordapp.com",
  "reddit.com",
  "redditmail.com",
  "pinterest.com",
  "tiktok.com",
  "snapchat.com",
  "threads.net",
];

export function isSocialDomain(domain) {
  const host = String(domain || "").toLowerCase().replace(/\.+$/, "");
  return SOCIAL_DOMAINS.some(known => host === known || host.endsWith(`.${known}`));
}

function hasHeader(headers, name) {
  return headerValue(headers, name).trim() !== "";
}

function isMailingList(headers) {
  if (hasHeader(headers, "list-unsubscribe") || hasHeader(headers, "list-id")) {
    return true;
  }
  const precedence = headerValue(headers, "precedence").toLowerCase();
  if (/\b(?:bulk|list|junk)\b/.test(precedence)) {
    return true;
  }
  const auto = headerValue(headers, "auto-submitted").trim().toLowerCase();
  return Boolean(auto && auto !== "no");
}

function isBulkAddress(author) {
  const [email] = emailsIn(author);
  if (!email) {
    return false;
  }
  const local = email.slice(0, email.lastIndexOf("@"));
  return BULK_LOCAL.test(local);
}

function isSocial(author) {
  const [email] = emailsIn(author);
  return email ? isSocialDomain(domainOf(email)) : false;
}

function isPersonal(to, cc, accountEmails) {
  const mine = new Set(emailsIn(accountEmails));
  if (!mine.size) {
    return false;
  }
  return emailsIn([...(to || []), ...(cc || [])]).some(email => mine.has(email));
}

export function classifyHeuristic({
  headers,
  author,
  to = [],
  cc = [],
  accountEmails = [],
  inAddressBook = false,
}) {
  if (isMailingList(headers)) {
    return { category: "newsletters", confident: true };
  }
  if (isSocial(author)) {
    return { category: "social", confident: true };
  }
  if (isBulkAddress(author)) {
    return { category: "newsletters", confident: true };
  }
  if (inAddressBook || isPersonal(to, cc, accountEmails)) {
    return { category: "important", confident: true };
  }
  return { category: null, confident: false };
}
