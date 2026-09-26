import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDateIST, formatDateTimeIST, startOfTodayIST } from "@/lib/format/datetime";

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
