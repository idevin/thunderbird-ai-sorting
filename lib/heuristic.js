import { domainOf, emailsIn, headerValue } from "./text.js";
import { folderNameFromDomain, isFreemail, serviceFromDomain } from "./services.js";

const BULK_LOCAL =
  /^(?:no-?reply|do-?not-?reply|donotreply|newsletter|news|notify|notifications|mailer-daemon|bounce)(?:$|[+._-])/i;

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

export function classifyHeuristic({
  headers,
  author,
  inAddressBook = false,
}) {
  const [email] = emailsIn(author);
  const domain = domainOf(email);
  const known = serviceFromDomain(domain);
  if (known) {
    return { service: known, confident: true };
  }
  if (isMailingList(headers) || isBulkAddress(author)) {
    const name = folderNameFromDomain(domain);
    if (name) {
      return { service: name, confident: true };
    }
    return { service: null, confident: false };
  }
  if (inAddressBook || isFreemail(domain)) {
    return { service: "", confident: true };
  }
  return { service: null, confident: false };
}
