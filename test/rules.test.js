import assert from "node:assert/strict";
import test from "node:test";
import { classifyHeuristic } from "../lib/heuristic.js";
import { availableTagName } from "../lib/tags.js";
import {
  categoryFromModel,
  parseGeminiContent,
  parseModelJson,
  parseOpenAiContent,
  redact,
} from "../lib/providers.js";
import { normalizeSettings } from "../lib/settings.js";
import { messageText, replyHtml, stripHtml } from "../lib/text.js";
import { clipThread, extractMessageIds, normalizeMessageId, normalizeSubject } from "../lib/thread.js";

test("a tag name avoids Thunderbird's built-in Important tag", () => {
  const used = new Set(["Important", "Work", "Personal", "To Do", "Later"]);
  assert.equal(availableTagName("AI Important", used), "AI Important");
  assert.equal(availableTagName("Important", used), "Important (AI)");
  used.add("Important (AI)");
  assert.equal(availableTagName("Important", used), "Important (AI 2)");
});

test("list headers are newsletters even from a social domain", () => {
  const decision = classifyHeuristic({
    headers: { "List-Unsubscribe": ["<mailto:bye@linkedin.com>"] },
    author: "LinkedIn <noreply@linkedin.com>",
    inAddressBook: true,
    to: ["me@example.com"],
    accountEmails: ["me@example.com"],
  });
  assert.deepEqual(decision, { category: "newsletters", confident: true });
});

test("precedence bulk and auto-submitted are newsletters", () => {
  assert.equal(
    classifyHeuristic({
      headers: { Precedence: "bulk" },
      author: "News <desk@example.com>",
    }).category,
    "newsletters"
  );
  assert.equal(
    classifyHeuristic({
      headers: { "Auto-Submitted": "auto-generated" },
      author: "Bot <bot@example.com>",
    }).category,
    "newsletters"
  );
  assert.equal(
    classifyHeuristic({
      headers: { "Auto-Submitted": "no" },
      author: "Ann <ann@example.com>",
      to: ["me@example.com"],
      accountEmails: ["me@example.com"],
    }).category,
    "important"
  );
});

test("a social domain stays social, including noreply", () => {
  assert.equal(
    classifyHeuristic({
      author: "LinkedIn <noreply@linkedin.com>",
      headers: {},
    }).category,
    "social"
  );
  assert.equal(
    classifyHeuristic({
      author: "Instagram <note@mail.instagram.com>",
      headers: {},
    }).category,
    "social"
  );
  assert.equal(
    classifyHeuristic({
      author: "X <hi@x.com>",
      headers: {},
    }).category,
    "social"
  );
});

test("a lookalike domain is not social", () => {
  const decision = classifyHeuristic({
    headers: {},
    author: "Pat <a@notx.com>",
  });
  assert.deepEqual(decision, { category: null, confident: false });
});

test("bulk local-parts are newsletters and personal mail is important", () => {
  assert.equal(
    classifyHeuristic({
      headers: {},
      author: "Shop <noreply@shop.example>",
    }).category,
    "newsletters"
  );
  assert.equal(
    classifyHeuristic({
      headers: {},
      author: "Ada <ada@example.com>",
      inAddressBook: true,
    }).category,
    "important"
  );
  assert.equal(
    classifyHeuristic({
      headers: {},
      author: "Ada <ada@example.com>",
      to: ["Me <me@example.com>"],
      accountEmails: ["me@example.com"],
    }).category,
    "important"
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
  assert.equal(settings.keys.grok, "");
  assert.equal(settings.models.gemini, "gemini-2.5-flash");
  assert.equal(normalizeSettings({ provider: "nope" }).provider, "openai");
});
