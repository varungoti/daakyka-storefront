import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatInrExact } from "@/lib/currency/admin-money";

describe("formatInrExact (F-202)", () => {
  it("shows paise for a fractional amount instead of rounding it away", () => {
    // The old `maximumFractionDigits: 0` formatter rendered this as ₹530.
    assert.equal(formatInrExact(530.1), "₹530.10");
  });

  it("does not add paise to a clean whole-rupee amount by default", () => {
    assert.equal(formatInrExact(500), "₹500");
  });

  it("always shows paise when alwaysShowPaise is set, even for a whole rupee amount", () => {
    assert.equal(formatInrExact(500, { alwaysShowPaise: true }), "₹500.00");
  });

  it("rounds floating-point line-item drift to the nearest paisa (199.99 * 3)", () => {
    assert.equal(formatInrExact(199.99 * 3), "₹599.97");
  });

  it("matches a real percentage-discount total (10% off ₹479)", () => {
    assert.equal(formatInrExact(479 - 47.9), "₹431.10");
  });
});
