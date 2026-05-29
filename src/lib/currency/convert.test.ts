import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  convertFromBase,
  convertToBase,
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

  it("formats INR without decimals", () => {
    const formatted = formatCurrencyAmount(2499, "INR");
    assert.match(formatted, /2,499|₹2,499/);
  });
});
