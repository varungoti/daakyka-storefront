import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDiscountListState, type DiscountStateInput } from "@/lib/discounts/status";

const NOW = new Date("2026-10-02T06:30:00.000Z");

function discount(overrides: Partial<DiscountStateInput> = {}): DiscountStateInput {
  return { active: true, startsAt: null, endsAt: null, maxRedemptions: null, redeemedCount: 0, ...overrides };
}

describe("getDiscountListState (F-206)", () => {
  it("is ACTIVE with no window and no cap", () => {
    assert.equal(getDiscountListState(discount(), NOW), "ACTIVE");
  });

  it("is INACTIVE when switched off, even inside its window", () => {
    assert.equal(getDiscountListState(discount({ active: false }), NOW), "INACTIVE");
    assert.equal(
      getDiscountListState(discount({ active: false, startsAt: new Date("2026-09-01"), endsAt: new Date("2026-11-01") }), NOW),
      "INACTIVE",
    );
  });

  it("is SCHEDULED before startsAt (start is inclusive)", () => {
    assert.equal(getDiscountListState(discount({ startsAt: new Date("2026-10-03T00:00:00Z") }), NOW), "SCHEDULED");
    assert.equal(getDiscountListState(discount({ startsAt: NOW }), NOW), "ACTIVE");
  });

  it("is EXPIRED once endsAt has passed (end is exclusive)", () => {
    assert.equal(getDiscountListState(discount({ endsAt: new Date("2026-10-01T00:00:00Z") }), NOW), "EXPIRED");
    assert.equal(getDiscountListState(discount({ endsAt: NOW }), NOW), "EXPIRED");
    assert.equal(getDiscountListState(discount({ endsAt: new Date("2026-10-03T00:00:00Z") }), NOW), "ACTIVE");
  });

  it("is LIMIT_REACHED when redemptions hit the cap", () => {
    assert.equal(getDiscountListState(discount({ maxRedemptions: 5, redeemedCount: 5 }), NOW), "LIMIT_REACHED");
    assert.equal(getDiscountListState(discount({ maxRedemptions: 5, redeemedCount: 4 }), NOW), "ACTIVE");
  });

  it("accepts ISO strings as well as Dates", () => {
    assert.equal(getDiscountListState(discount({ endsAt: "2026-09-30T00:00:00.000Z" }), NOW), "EXPIRED");
  });
});
