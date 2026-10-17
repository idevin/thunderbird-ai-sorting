import { draftInCompose, draftReply, summarizeMessage } from "./lib/assist.js";
import { classifyMessage, loadAccountEmails } from "./lib/classify.js";
import { redact } from "./lib/providers.js";
import { loadSettings } from "./lib/settings.js";
import {
  completeSortJob,
  createSortJob,
  failSortJob,
  noteFailure,
  noteResult,
  rememberIds,
  restoreSortJob,
  serializeSortJob,
  sortStatus,
} from "./lib/sort-job.js";

const ALARM = "sort-messages";
const SESSION_KEY = "sortJob";
// Shorter than the event-page idle timeout, so a closed popup cannot suspend the sort.
const ALARM_PERIOD_MINUTES = 0.2;

let job = null;
let pumping = false;
let ready = null;
let sortGeneration = 0;

async function eachMessage(list) {
  const messages = [];
  let page = list;
  while (page) {
    messages.push(...(page.messages || []));
    if (!page.id) {
      break;
    }
    page = await browser.messages.continueList(page.id);
  }
  return messages;
}

async function eachId(list) {
  const ids = [];
  let page = list;
  while (page) {
    for (const message of page.messages || []) {
      if (message && Number.isInteger(message.id)) {
        ids.push(message.id);
      }
    }
    if (!page.id) {
      break;
    }
    page = await browser.messages.continueList(page.id);
  }
  return ids;
}

async function idsForTab(tabId) {
  let tab;
  try {
    tab = await browser.mailTabs.get(tabId);
  } catch (error) {
    console.error("AI Sorting", redact(error && error.message));
    throw new Error("no-folder");
  }
  const selected = await browser.mailTabs.getSelectedMessages(tabId);
  if ((selected.messages || []).length > 1) {
    return eachId(selected);
  }
  const folderId = tab && tab.displayedFolder && tab.displayedFolder.id;
  if (!folderId) {
    throw new Error("no-folder");
  }
  return eachId(await browser.messages.list(folderId));
}

async function persist() {
  if (!job) {
    return;
  }
  try {
    await browser.storage.session.set({ [SESSION_KEY]: serializeSortJob(job) });
  } catch (error) {
    console.error("AI Sorting", redact(error && error.message));
  }
}

async function armAlarm() {
  await browser.alarms.create(ALARM, {
    when: Date.now() + 150,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  });
}

async function disarmAlarm() {
  const generation = sortGeneration;
  try {
    await browser.alarms.clear(ALARM);
  } catch (error) {
    console.error("AI Sorting", redact(error && error.message));
    return;
  }
  if (generation !== sortGeneration && job && job.running) {
    try {
      await armAlarm();
    } catch (error) {
      console.error("AI Sorting", redact(error && error.message));
    }
  }
}

async function beginSort(tabId) {
  if (job && job.running) {
    return;
  }
  sortGeneration += 1;
  job = createSortJob(tabId);
  if (!Number.isInteger(job.tabId)) {
    failSortJob(job, "no-folder");
    await persist();
    return;
  }
  await persist();
  await armAlarm();
}

async function pump() {
  if (pumping || !job || !job.running) {
    return;
  }
  pumping = true;
  try {
    if (job.phase === "listing") {
      rememberIds(job, await idsForTab(job.tabId));
      await persist();
    }
    const settings = await loadSettings();
    const accountEmails = await loadAccountEmails();
    const bookCache = new Map();
    while (job.running && job.index < job.ids.length) {
      const id = job.ids[job.index];
      try {
        const result = await classifyMessage(id, {
          force: false,
          allowAi: settings.useAiForUncertain,
          settings,
          accountEmails,
          bookCache,
        });
        noteResult(job, result);
      } catch (error) {
        const detail = redact(error && error.message);
        noteFailure(job, detail);
        console.error("AI Sorting", detail);
      }
      await persist();
    }
    completeSortJob(job);
    await persist();
  } catch (error) {
    const fatal = error && error.message === "no-folder" ? "no-folder" : redact(error && error.message);
    console.error("AI Sorting", fatal);
    failSortJob(job, fatal);
    await persist();
  } finally {
    pumping = false;
    if (!job || !job.running) {
      await disarmAlarm();
    }
  }
}

async function resumeSort() {
  try {
    const stored = await browser.storage.session.get(SESSION_KEY);
    job = restoreSortJob(stored && stored[SESSION_KEY]);
  } catch (error) {
    console.error("AI Sorting", redact(error && error.message));
    job = null;
  }
  if (!job || !job.running) {
    return;
  }
  try {
    const existing = await browser.alarms.get(ALARM);
    if (!existing) {
      await armAlarm();
    }
  } catch (error) {
    console.error("AI Sorting", redact(error && error.message));
  }
}

function whenReady() {
  if (!ready) {
    ready = resumeSort();
  }
  return ready;
}

browser.messages.onNewMailReceived.addListener(async (folder, list) => {
  if (!folder || folder.type !== "inbox") {
    return;
  }
  const settings = await loadSettings();
  if (!settings.autoClassify) {
    return;
  }
  const messages = await eachMessage(list);
  const accountEmails = await loadAccountEmails();
  const bookCache = new Map();
  for (const message of messages) {
    try {
      await classifyMessage(message, {
        force: false,
        allowAi: settings.useAiForUncertain,
        settings,
        accountEmails,
        bookCache,
      });
    } catch (error) {
      console.error("AI Sorting", redact(error && error.message));
    }
  }
});

function dispatch(message) {
  switch (message.type) {
    case "sort-start":
      return whenReady().then(() => beginSort(message.tabId).then(() => sortStatus(job)));
    case "sort-status":
      return whenReady().then(() => sortStatus(job));
    case "classify-one":
      return classifyMessage(message.messageId, { force: true });
    case "summarize":
      return summarizeMessage(message.messageId).then(text => ({ text }));
    case "draft-reply":
      return draftReply(message.messageId, message.instruction).then(() => ({ ok: true }));
    case "draft-compose":
      return draftInCompose(message.tabId, message.instruction).then(() => ({ ok: true }));
    default:
      return undefined;
  }
}

// Sorting used to run as the reply to the popup. Closing the menu dropped that
// reply and the event page then went idle. The alarm owns the job instead.
browser.runtime.onMessage.addListener((message, sender) => {
  if (!sender || sender.id !== browser.runtime.id || !message || typeof message.type !== "string") {
    return undefined;
  }
  return dispatch(message);
});

browser.alarms.onAlarm.addListener(alarm => {
  if (!alarm || alarm.name !== ALARM) {
    return undefined;
  }
  return whenReady().then(async () => {
    if (!job || !job.running) {
      await disarmAlarm();
      return;
    }
    await pump();
  });
});

whenReady();
