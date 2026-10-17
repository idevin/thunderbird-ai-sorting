import { emptyCounts, recordClassification, recordFailure } from "./classify.js";

const PHASES = new Set(["listing", "sorting", "done", "error"]);

export function createSortJob(tabId) {
  return {
    running: true,
    phase: "listing",
    tabId: Number.isInteger(tabId) ? tabId : null,
    ids: [],
    index: 0,
    counts: emptyCounts(),
    fatal: "",
  };
}

export function rememberIds(job, ids) {
  job.ids = [...new Set((ids || []).filter(id => Number.isInteger(id)))];
  job.index = 0;
  job.phase = "sorting";
  job.running = true;
}

export function noteResult(job, result) {
  recordClassification(job.counts, result);
  job.index += 1;
}

export function noteFailure(job, detail) {
  recordFailure(job.counts, detail);
  job.index += 1;
}

export function completeSortJob(job) {
  job.running = false;
  job.phase = "done";
}

export function failSortJob(job, fatal) {
  job.running = false;
  job.phase = "error";
  job.fatal = fatal ? String(fatal) : "empty";
}

export function serializeSortJob(job) {
  return {
    running: job.running === true,
    phase: job.phase,
    tabId: job.tabId,
    ids: job.ids,
    index: job.index,
    counts: job.counts,
    fatal: job.fatal || "",
  };
}

function restoreCounts(counts) {
  const next = emptyCounts();
  const source = counts && typeof counts === "object" ? counts : {};
  for (const key of ["inbox", "undecided", "capped", "skipped", "failed"]) {
    const value = source[key];
    next[key] = Number.isInteger(value) && value > 0 ? value : 0;
  }
  if (typeof source.error === "string" && source.error) {
    next.error = source.error;
  }
  const folders = source.folders && typeof source.folders === "object" ? source.folders : {};
  for (const [name, count] of Object.entries(folders)) {
    if (name && Number.isInteger(count) && count > 0) {
      next.folders[name] = count;
    }
  }
  return next;
}

export function restoreSortJob(saved) {
  if (!saved || typeof saved !== "object" || !PHASES.has(saved.phase)) {
    return null;
  }
  const ids = Array.isArray(saved.ids) ? saved.ids.filter(id => Number.isInteger(id)) : [];
  let index = Number.isInteger(saved.index) && saved.index > 0 ? saved.index : 0;
  if (index > ids.length) {
    index = ids.length;
  }
  let phase = saved.phase;
  let running = saved.running === true && (phase === "listing" || phase === "sorting");
  if (running && phase === "sorting" && index >= ids.length) {
    running = false;
    phase = "done";
  }
  return {
    running,
    phase,
    tabId: Number.isInteger(saved.tabId) ? saved.tabId : null,
    ids,
    index,
    counts: restoreCounts(saved.counts),
    fatal: typeof saved.fatal === "string" ? saved.fatal : "",
  };
}

export function sortStatus(job) {
  if (!job) {
    return { phase: "idle", processed: 0, total: 0, counts: emptyCounts(), fatal: "" };
  }
  return {
    phase: job.phase,
    processed: job.index,
    total: job.phase === "listing" ? 0 : job.ids.length,
    counts: job.counts,
    fatal: job.fatal || "",
  };
}
