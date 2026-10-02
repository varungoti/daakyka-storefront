import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  convertFromBase,
  convertToBase,
  formatBasePrice,
  formatCurrencyAmount,
} from "@/lib/currency/convert";

describe("currency conversion", () => {
  it("returns INR amounts unchanged", () => {
    assert.equal(convertFromBase(2499, "INR"), 2499);
    assert.equal(convertToBase(2499, "INR"), 2499);
  });

  it("converts INR to USD using configured rate", () => {
    assert.equal(convertFromBase(8300, "USD"), 100);
    assert.equal(convertToBase(100, "USD"), 8300);
  });

  // F-014: USD was rounded to a whole dollar and then printed with cents, so
  // ₹149 and ₹199 both read "$2.00" and ₹299 "$4.00" (true: 1.80 / 2.40 / 3.60).
  it("keeps USD cents instead of rounding to a whole dollar (F-014)", () => {
    assert.equal(convertFromBase(149, "USD"), 1.8);
    assert.equal(convertFromBase(199, "USD"), 2.4);
    assert.equal(convertFromBase(299, "USD"), 3.6);
    assert.equal(formatBasePrice(149, "USD"), "$1.80");
    assert.equal(formatBasePrice(199, "USD"), "$2.40");
    assert.equal(formatBasePrice(299, "USD"), "$3.60");
  });

  it("gives different INR prices different USD prices (F-014)", () => {
    const shown = [149, 199, 299, 479, 599].map((inr) => formatBasePrice(inr, "USD"));
    assert.equal(new Set(shown).size, shown.length);
  });

  it("keeps a USD sale badge consistent with the shown prices (F-014)", () => {
    // ₹479 was ₹599: 20.03% off in INR. The old whole-dollar display read
    // "$6.00 was $7.00" (14%); with cents it is $5.77 was $7.22 (20%).
    const sale = convertFromBase(479, "USD");
    const was = convertFromBase(599, "USD");
    assert.equal(sale, 5.77);
    assert.equal(was, 7.22);
    const shownPercent = Math.round((1 - sale / was) * 100);
    const inrPercent = Math.round((1 - 479 / 599) * 100);
    assert.equal(shownPercent, inrPercent);
  });

  it("sums per-item USD amounts without drifting past a cent from the INR total", () => {
    const items = [149, 199, 299];
    const perItem = items.reduce((sum, inr) => sum + convertFromBase(inr, "USD"), 0);
    assert.ok(Math.abs(perItem - convertFromBase(647, "USD")) <= 0.02);
  });
});

describe("currency formatting", () => {
  it("formats whole-rupee INR amounts without decimals", () => {
    const formatted = formatCurrencyAmount(2499, "INR");
    assert.match(formatted, /2,499|₹2,499/);
    assert.ok(!formatted.includes("."), `unexpected decimals in ${formatted}`);
  });

  // F-127: paise were rounded away ("₹639" for a ₹638.97 order total).
  it("shows paise when an INR amount has them (F-127)", () => {
    assert.equal(formatCurrencyAmount(638.97, "INR"), "₹638.97");
    assert.equal(formatCurrencyAmount(599.97, "INR"), "₹599.97");
    assert.equal(formatCurrencyAmount(134.85, "INR"), "₹134.85");
    assert.equal(formatCurrencyAmount(1234.5, "INR"), "₹1,234.50");
  });

  it("absorbs floating-point noise before deciding whether there are paise (F-127)", () => {
    // 199.99 * 3 is 599.9699999999999 in floating point.
    assert.equal(formatCurrencyAmount(199.99 * 3, "INR"), "₹599.97");
    // 0.1 + 0.2 style drift on a whole-rupee amount must not grow ".00".
    assert.equal(formatCurrencyAmount(100.00000000000001, "INR"), "₹100");
  });

  it("always prints cents for USD", () => {
    assert.equal(formatCurrencyAmount(2, "USD"), "$2.00");
    assert.equal(formatCurrencyAmount(1.8, "USD"), "$1.80");
  });
});
