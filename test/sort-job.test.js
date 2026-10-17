import assert from "node:assert/strict";
import test from "node:test";
import {
  completeSortJob,
  createSortJob,
  failSortJob,
  noteFailure,
  noteResult,
  rememberIds,
  restoreSortJob,
  sortStatus,
} from "../lib/sort-job.js";

test("a sort keeps its place and counts after the popup is gone", () => {
  const job = createSortJob(4);
  assert.equal(sortStatus(job).phase, "listing");
  assert.equal(sortStatus(job).total, 0);

  rememberIds(job, [10, 10, 11, 12, 13, "nope"]);
  noteResult(job, { outcome: "sorted", service: "GitHub" });
  noteResult(job, { outcome: "inbox" });
  noteFailure(job, "provider:busy");

  const status = sortStatus(job);
  assert.equal(status.phase, "sorting");
  assert.equal(status.processed, 3);
  assert.equal(status.total, 4);
  assert.equal(status.counts.folders.GitHub, 1);
  assert.equal(status.counts.inbox, 1);
  assert.equal(status.counts.failed, 1);
  assert.equal(status.counts.error, "provider:busy");

  const restored = restoreSortJob(job);
  assert.equal(restored.running, true);
  assert.equal(restored.phase, "sorting");
  assert.equal(restored.index, 3);
  assert.deepEqual(restored.ids, [10, 11, 12, 13]);
  assert.equal(sortStatus(restored).counts.folders.GitHub, 1);
});

test("a finished sort is still visible and does not resume", () => {
  const job = createSortJob(4);
  rememberIds(job, [1]);
  noteResult(job, { outcome: "sorted", service: "Google" });
  completeSortJob(job);

  const restored = restoreSortJob(job);
  assert.equal(restored.running, false);
  assert.equal(restored.phase, "done");
  assert.equal(sortStatus(restored).counts.folders.Google, 1);
  assert.equal(sortStatus(null).phase, "idle");
});

test("a sort that already finished every id is not started again", () => {
  const restored = restoreSortJob({
    running: true,
    phase: "sorting",
    tabId: 2,
    ids: [5, 6],
    index: 2,
    counts: { folders: { GitHub: 2 }, inbox: 0, undecided: 0, capped: 0, skipped: 0, failed: 0 },
    fatal: "",
  });
  assert.equal(restored.running, false);
  assert.equal(restored.phase, "done");
});

test("reading the folder is still in progress", () => {
  const restored = restoreSortJob(createSortJob(9));
  assert.equal(restored.running, true);
  assert.equal(restored.phase, "listing");
  assert.equal(restored.tabId, 9);
  assert.equal(sortStatus(restored).processed, 0);
});

test("a failed sort keeps the reason", () => {
  const job = createSortJob(null);
  failSortJob(job, "no-folder");
  const restored = restoreSortJob(job);
  assert.equal(restored.phase, "error");
  assert.equal(restored.running, false);
  assert.equal(restored.fatal, "no-folder");
  assert.equal(restoreSortJob({ phase: "nope" }), null);
});
