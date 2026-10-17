import assert from "node:assert/strict";
import test from "node:test";
import { classifyHeuristic } from "../lib/heuristic.js";
import { resolveTagKeys } from "../lib/tags.js";
import {
  categoryFromModel,
  parseGeminiContent,
  parseModelJson,
  parseOpenAiContent,
  providerErrorText,
  redact,
} from "../lib/providers.js";
import { normalizeSettings } from "../lib/settings.js";
import { messageText, replyHtml, stripHtml } from "../lib/text.js";
import { clipThread, extractMessageIds, normalizeMessageId, normalizeSubject } from "../lib/thread.js";

test("an existing Important tag is reused", () => {
  const keys = resolveTagKeys(
    [
      { key: "$label1", tag: "Important" },
      { key: "$label2", tag: "Work" },
    ],
    { important: "Important", newsletters: "Newsletters", social: "Social" }
  );
  assert.equal(keys.important, "$label1");
  assert.equal(keys.newsletters, "ai-newsletters");
  assert.equal(keys.social, "ai-social");
});

test("mail from a known service is filed under that service", () => {
  const decision = classifyHeuristic({
    headers: { "List-Unsubscribe": ["<mailto:bye@linkedin.com>"] },
    author: "LinkedIn <noreply@linkedin.com>",
    inAddressBook: true,
    to: ["me@example.com"],
    accountEmails: ["me@example.com"],
  });
  assert.deepEqual(decision, { service: "LinkedIn", confident: true });
});

test("bulk mail uses the sender's service and personal mail stays in the inbox", () => {
  assert.equal(
    classifyHeuristic({
      headers: { Precedence: "bulk" },
      author: "News <desk@example.com>",
    }).service,
    "Example"
  );
  assert.equal(
    classifyHeuristic({
      headers: { "Auto-Submitted": "auto-generated" },
      author: "Bot <bot@shop.example>",
    }).service,
    "Shop"
  );
  assert.deepEqual(
    classifyHeuristic({
      headers: { "Auto-Submitted": "no" },
      author: "Ann <ann@example.com>",
      to: ["me@example.com"],
      accountEmails: ["me@example.com"],
    }),
    { service: null, confident: false }
  );
});

test("a known service keeps its name, including noreply", () => {
  assert.equal(
    classifyHeuristic({
      author: "LinkedIn <noreply@linkedin.com>",
      headers: {},
    }).service,
    "LinkedIn"
  );
  assert.equal(
    classifyHeuristic({
      author: "Instagram <note@mail.instagram.com>",
      headers: {},
    }).service,
    "Instagram"
  );
  assert.equal(
    classifyHeuristic({
      author: "X <hi@x.com>",
      headers: {},
    }).service,
    "X"
  );
});

test("a lookalike domain is not treated as a known service", () => {
  const decision = classifyHeuristic({
    headers: {},
    author: "Pat <a@notx.com>",
  });
  assert.deepEqual(decision, { service: null, confident: false });
});

test("bulk local-parts name a folder and personal mail stays in the inbox", () => {
  assert.equal(
    classifyHeuristic({
      headers: {},
      author: "Shop <noreply@shop.example>",
    }).service,
    "Shop"
  );
  assert.equal(
    classifyHeuristic({
      headers: {},
      author: "Ada <ada@gmail.com>",
      inAddressBook: true,
    }).service,
    ""
  );
  assert.deepEqual(
    classifyHeuristic({
      headers: {},
      author: "Ada <ada@example.com>",
      to: ["Me <me@example.com>"],
      accountEmails: ["me@example.com"],
    }),
    { service: null, confident: false }
  );
});

test("subject and message ids are normalized", () => {
  assert.equal(normalizeSubject("Re: Re[2]: Fwd: Hello"), "Hello");
  assert.equal(normalizeSubject("Aw: Hallo"), "Hallo");
  assert.deepEqual(extractMessageIds("see <A@B> and <c@d>"), ["<a@b>", "<c@d>"]);
  assert.equal(normalizeMessageId("ABC@host"), "<abc@host>");
  assert.equal(normalizeMessageId("<Abc@Host>"), "<abc@host>");
});

test("thread clip keeps the newest text inside the budget", () => {
  const clipped = clipThread(
    [
      { date: 1, body: "a".repeat(10) },
      { date: 2, body: "b".repeat(10) },
      { date: 3, body: "c".repeat(10) },
    ],
    { maxChars: 15, perMessage: 1500, maxMessages: 15 }
  );
  assert.equal(clipped.length, 1);
  assert.equal(clipped[0].body, "c".repeat(10));

  const one = clipThread([{ date: 1, body: "z".repeat(100) }], { maxChars: 20, perMessage: 100 });
  assert.equal(one[0].body.length, 20);
});

test("plain text is preferred and attachments are skipped", () => {
  const text = messageText({
    contentType: "multipart/mixed",
    parts: [
      { contentType: "text/html", body: "<p>Hi</p>" },
      { contentType: "text/plain", body: "Hello" },
      { contentType: "text/plain", name: "notes.txt", body: "secret attachment" },
    ],
  });
  assert.equal(text, "Hello");
  assert.equal(stripHtml("<style>p{}</style><p>A &amp; B</p>"), "A & B");
  assert.equal(replyHtml("Hi <there>\n\nLine"), "<p>Hi &lt;there&gt;</p><p>Line</p>");
});

test("provider payloads and model JSON are parsed", () => {
  assert.equal(
    parseOpenAiContent({ choices: [{ message: { content: "ok" } }] }),
    "ok"
  );
  assert.equal(
    parseOpenAiContent({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }),
    "ab"
  );
  assert.equal(
    parseGeminiContent({ candidates: [{ content: { parts: [{ text: "sum" }] } }] }),
    "sum"
  );
  assert.equal(categoryFromModel('```json\n{"category":"social"}\n```'), "social");
  assert.equal(parseModelJson('note {"category":"other"} thanks').category, "other");
  assert.throws(() => categoryFromModel('{"category":"spam"}'), /unknown-category/);
  assert.throws(() => parseModelJson("no object"), /no-json/);
});

test("a provider error is shown as its message", () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      message:
        "You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
    },
  });
  const text = providerErrorText(`provider:429:${body}`);
  assert.equal(text.includes("{"), false);
  assert.equal(text.includes("\n"), false);
  assert.match(text, /^You exceeded your current quota, please check your plan and billing details\. \* Quota exceeded/);
  assert.equal(
    providerErrorText(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } })),
    "Incorrect API key provided"
  );
  const truncated = '{ "error": { "code": 429, "message": "You exceeded your current quota';
  assert.equal(providerErrorText(`provider:429:${truncated}`), "You exceeded your current quota");
  assert.equal(providerErrorText("provider:502:"), "");
  assert.equal(providerErrorText("bad gateway"), "bad gateway");
});

test("secrets are redacted and settings keep each provider", () => {
  const hidden = redact("failed key=AIzaSySECRET123456 sk-abcDEF1234567890");
  assert.equal(hidden.includes("AIzaSySECRET123456"), false);
  assert.equal(hidden.includes("sk-abcDEF1234567890"), false);
  assert.match(hidden, /key=…/);
  assert.equal(redact("token xai-secret-value-1", "xai-secret-value-1").includes("xai-secret-value-1"), false);

  const settings = normalizeSettings({
    provider: "gemini",
    autoClassify: false,
    keys: { gemini: "  secret  ", openai: "sk" },
    models: { gemini: "gemini-2.5-flash" },
  });
  assert.equal(settings.provider, "gemini");
  assert.equal(settings.autoClassify, false);
  assert.equal(settings.useAiForUncertain, true);
  assert.equal(settings.keys.gemini, "secret");
  assert.equal(settings.keys.openai, "sk");
  assert.equal(settings.models.gemini, "gemini-2.5-flash");
  assert.equal(normalizeSettings({ provider: "nope" }).provider, "openai");
});
