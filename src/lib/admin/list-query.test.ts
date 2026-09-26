import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createLoadGuard, debounce, MIN_SEARCH_CHARS, normalizeSearchTerm } from "@/lib/admin/list-query";

// F-341 (release-hardening admin-table-mobile-and-pagination-perf): the
// admin orders/customers/products tables fired one request per keystroke,
// with no cancellation, so a slow early request could resolve after a
// faster later one and overwrite the table with stale data. These test the
// pure helpers extracted for the fix — see list-query.ts's file comment.

describe("debounce", () => {
  it("fires at most once, with the last call's args, after a burst of rapid calls pauses", async () => {
    const calls: string[] = [];
    const debounced = debounce((value: string) => calls.push(value), 20);

    // Mirrors the finding's repro: typing "vol-heavy" one keystroke at a
    // time, well inside the debounce delay.
    debounced("v");
    debounced("vo");
    debounced("vol");
    debounced("vol-");
    debounced("vol-heavy");

    // Still mid-burst (delay hasn't elapsed since the last call) — nothing
    // should have fired yet.
    await sleep(5);
    assert.deepEqual(calls, []);

    // The burst has now paused for longer than the debounce delay.
    await sleep(40);
    assert.deepEqual(calls, ["vol-heavy"]);
  });

  it("restarts the timer on every call, not just the first", async () => {
    const calls: string[] = [];
    const debounced = debounce((value: string) => calls.push(value), 20);

    debounced("a");
    await sleep(15); // less than the delay — must not have fired yet
    debounced("b"); // restarts the 20ms timer
    await sleep(15); // still less than 20ms since "b"
    assert.deepEqual(calls, []);

    await sleep(15);
    assert.deepEqual(calls, ["b"]);
  });

  it("cancel() drops a pending call so it never fires", async () => {
    const calls: string[] = [];
    const debounced = debounce((value: string) => calls.push(value), 20);
    debounced("x");
    debounced.cancel();
    await sleep(40);
    assert.deepEqual(calls, []);
  });
});

describe("createLoadGuard", () => {
  it("treats only the most recently started request as current", () => {
    const guard = createLoadGuard();
    const first = guard.start();
    const second = guard.start();
    assert.equal(guard.isCurrent(second), true);
    assert.equal(guard.isCurrent(first), false);
  });

  it("drops a slow request's response that resolves after a faster, later one already applied", () => {
    // Mirrors the finding's exact repro: typing "vol-heavy" fires one
    // request per keystroke; "vol-" (started earlier) takes longer to
    // resolve and arrives after "vol-heavy" (started later) already has.
    const guard = createLoadGuard();
    const volDash = guard.start(); // "vol-" — slow
    const volHeavy = guard.start(); // "vol-heavy" — fast, supersedes it

    // The fast one resolves first, and is still current — it's applied.
    assert.equal(guard.isCurrent(volHeavy), true);

    // The slow one resolves afterwards — it must be ignored, not applied,
    // even though it's a "later" resolution in wall-clock time.
    assert.equal(guard.isCurrent(volDash), false);
  });

  it("a fresh guard rejects an id no request has actually started with", () => {
    const guard = createLoadGuard();
    // start() always returns 1 or higher — nothing has called it yet, so
    // the first id it will ever hand out isn't current until it does.
    assert.equal(guard.isCurrent(1), false);
  });
});

describe("normalizeSearchTerm", () => {
  it(`treats anything shorter than ${MIN_SEARCH_CHARS} characters as no search term`, () => {
    assert.equal(normalizeSearchTerm(""), "");
    assert.equal(normalizeSearchTerm(" "), "");
    assert.equal(normalizeSearchTerm("v"), "");
  });

  it("trims and passes through a term that meets the minimum", () => {
    assert.equal(normalizeSearchTerm("vo"), "vo");
    assert.equal(normalizeSearchTerm("  vo  "), "vo");
    assert.equal(normalizeSearchTerm("vol-heavy"), "vol-heavy");
  });
});
