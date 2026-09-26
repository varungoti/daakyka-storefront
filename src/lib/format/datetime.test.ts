import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDateIST,
  formatDateTimeIST,
  parseIstDateOnly,
  parseIstDateOnlyExclusiveEnd,
  startOfTodayIST,
} from "@/lib/format/datetime";

describe("startOfTodayIST (F-060)", () => {
  it("returns IST midnight, not UTC midnight, for a time after UTC midnight but before IST midnight", () => {
    // 2026-09-25T02:00:00Z is 07:30 IST on 25 Sept — well after IST
    // midnight, so "today" (IST) is the 25th.
    const now = new Date("2026-09-25T02:00:00Z");
    const start = startOfTodayIST(now);
    // IST midnight on 25 Sept 2026 is 2026-09-24T18:30:00Z.
    assert.equal(start.toISOString(), "2026-09-24T18:30:00.000Z");
  });

  it("does not roll over to the next IST day at UTC midnight", () => {
    // 2026-09-25T00:00:00Z is 05:30 IST on the 25th — still the 25th in
    // IST, unlike the old `setHours(0,0,0,0)` behaviour under TZ=UTC,
    // which would already consider this "today" starting exactly now.
    const now = new Date("2026-09-25T00:00:00Z");
    const start = startOfTodayIST(now);
    assert.equal(start.toISOString(), "2026-09-24T18:30:00.000Z");
  });

  it("treats 00:00-05:30 IST as still belonging to the previous IST day", () => {
    // 2026-09-24T20:00:00Z is 01:30 IST on the 25th.
    const now = new Date("2026-09-24T20:00:00Z");
    const start = startOfTodayIST(now);
    assert.equal(start.toISOString(), "2026-09-24T18:30:00.000Z");
  });
});

describe("formatDateTimeIST / formatDateIST (F-060)", () => {
  it("formats a UTC instant in IST regardless of the process timezone", () => {
    // 2026-09-24T20:15:00Z is 2026-09-25T01:45 IST.
    const formatted = formatDateTimeIST("2026-09-24T20:15:00Z");
    assert.match(formatted, /25/);
    assert.match(formatted, /1:45/);
    assert.match(formatted, /am/i);
  });

  it("formatDateIST renders the IST calendar date, not the UTC one", () => {
    const formatted = formatDateIST("2026-09-24T20:15:00Z");
    assert.match(formatted, /25/);
    assert.doesNotMatch(formatted, /\b24\b/);
  });
});

describe("parseIstDateOnly / parseIstDateOnlyExclusiveEnd (F-068)", () => {
  it("parses a yyyy-mm-dd string as IST midnight, not UTC midnight", () => {
    // `new Date("2026-09-25")` (the old buggy parse) gives
    // 2026-09-25T00:00:00Z, which is 05:30 IST — 5.5h *into* the day, not
    // its start. IST midnight on the 25th is 2026-09-24T18:30:00Z.
    const start = parseIstDateOnly("2026-09-25");
    assert.equal(start?.toISOString(), "2026-09-24T18:30:00.000Z");
  });

  it("the exclusive end is the next day's IST midnight, one full day later", () => {
    const end = parseIstDateOnlyExclusiveEnd("2026-09-25");
    assert.equal(end?.toISOString(), "2026-09-25T18:30:00.000Z");
  });

  it("includes an order placed right at 23:59:59 IST on the named day", () => {
    const end = parseIstDateOnlyExclusiveEnd("2026-09-25")!;
    const lateOrder = new Date("2026-09-25T18:29:59.000Z"); // 23:59:59 IST
    assert.ok(lateOrder.getTime() < end.getTime());
  });

  it("excludes an order placed at IST midnight the following day", () => {
    const end = parseIstDateOnlyExclusiveEnd("2026-09-25")!;
    const nextDayMidnight = new Date("2026-09-25T18:30:00.000Z"); // 00:00 IST on the 26th
    assert.ok(nextDayMidnight.getTime() >= end.getTime());
  });

  it("includes an order placed just after midnight IST on the From day (the old bug's other edge)", () => {
    const start = parseIstDateOnly("2026-09-25")!;
    const earlyOrder = new Date("2026-09-24T19:00:00.000Z"); // 00:30 IST on the 25th
    assert.ok(earlyOrder.getTime() >= start.getTime());
  });

  it("returns undefined for null/empty/malformed input instead of an Invalid Date", () => {
    assert.equal(parseIstDateOnly(null), undefined);
    assert.equal(parseIstDateOnly(""), undefined);
    assert.equal(parseIstDateOnly("2026-9-5"), undefined);
    assert.equal(parseIstDateOnly("not-a-date"), undefined);
    assert.equal(parseIstDateOnlyExclusiveEnd("garbage"), undefined);
  });
});
