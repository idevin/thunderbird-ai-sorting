import { parseModelJson } from "./providers.js";

const SERVICES = [
  ["LinkedIn", ["linkedin.com"]],
  ["Facebook", ["facebook.com", "facebookmail.com", "fb.com"]],
  ["Instagram", ["instagram.com"]],
  ["X", ["x.com", "twitter.com"]],
  ["VK", ["vk.com", "vk.ru", "vk.team"]],
  ["OK", ["ok.ru"]],
  ["Telegram", ["t.me", "telegram.org"]],
  ["Discord", ["discord.com", "discordapp.com"]],
  ["Reddit", ["reddit.com", "redditmail.com"]],
  ["YouTube", ["youtube.com", "youtu.be"]],
  ["Google", ["google.com", "googleapis.com", "withgoogle.com"]],
  ["GitHub", ["github.com"]],
  ["Microsoft", ["microsoft.com", "office.com", "office365.com"]],
  ["Apple", ["apple.com", "email.apple.com"]],
  ["Amazon", ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazonses.com"]],
  ["PayPal", ["paypal.com"]],
  ["Steam", ["steampowered.com", "steamcommunity.com"]],
  ["Netflix", ["netflix.com"]],
  ["Spotify", ["spotify.com"]],
  ["Adobe", ["adobe.com"]],
  ["Dropbox", ["dropbox.com"]],
  ["Slack", ["slack.com"]],
  ["Zoom", ["zoom.us"]],
  ["Notion", ["notion.so"]],
  ["OpenAI", ["openai.com"]],
  ["Pinterest", ["pinterest.com"]],
  ["TikTok", ["tiktok.com"]],
  ["Snapchat", ["snapchat.com"]],
  ["Threads", ["threads.net"]],
];

const FREEMAIL = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "mail.ru",
  "yandex.ru",
  "yandex.com",
  "proton.me",
  "protonmail.com",
];

const MULTI_SUFFIX = ["co.uk", "com.au", "co.jp", "com.br", "co.nz", "com.tr", "co.za"];

function hostOf(domain) {
  return String(domain || "").toLowerCase().replace(/\.+$/, "").replace(/^\.+/, "");
}

function matches(host, known) {
  return host === known || host.endsWith(`.${known}`);
}

export function sanitizeFolderName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function serviceFromDomain(domain) {
  const host = hostOf(domain);
  if (!host) {
    return "";
  }
  for (const [name, domains] of SERVICES) {
    if (domains.some(known => matches(host, known))) {
      return name;
    }
  }
  return "";
}

export function isFreemail(domain) {
  const host = hostOf(domain);
  return FREEMAIL.some(known => matches(host, known));
}

export function folderNameFromDomain(domain) {
  const host = hostOf(domain);
  if (!host || isFreemail(host)) {
    return "";
  }
  const known = serviceFromDomain(host);
  if (known) {
    return known;
  }
  let rest = host;
  for (const suffix of MULTI_SUFFIX) {
    if (host.endsWith(`.${suffix}`)) {
      rest = host.slice(0, -(suffix.length + 1));
      break;
    }
  }
  const parts = rest.split(".").filter(Boolean);
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "";
  if (label.length < 2) {
    return "";
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function serviceFromModel(text) {
  const data = parseModelJson(text);
  const raw = data && (data.service != null ? data.service : data.name);
  return sanitizeFolderName(raw);
}
