import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeIndianPhone, normalizeIndianPincode } from "@/lib/validation/india";

/**
 * Release-hardening Finding A: an order was placed live with phone "12345"
 * and pincode "AB123" — neither had any format validation at all. These
 * cover the exact shapes named in the audit plus the normalisation these
 * functions are responsible for (src/lib/validation/schemas.ts wraps them
 * for the server-side Zod schemas; checkout-page-content.tsx and
 * account-tabs.tsx call them directly for client-side inline errors).
 */
describe("normalizeIndianPhone", () => {
  it("accepts a bare 10-digit mobile number starting 6-9", () => {
    assert.equal(normalizeIndianPhone("9876543210"), "9876543210");
    assert.equal(normalizeIndianPhone("6000000000"), "6000000000");
    assert.equal(normalizeIndianPhone("7000000000"), "7000000000");
    assert.equal(normalizeIndianPhone("8000000000"), "8000000000");
  });

  it("strips a leading +91, tolerating spaces/hyphens", () => {
    assert.equal(normalizeIndianPhone("+91 98765 43210"), "9876543210");
    assert.equal(normalizeIndianPhone("+91-98765-43210"), "9876543210");
    assert.equal(normalizeIndianPhone("+919876543210"), "9876543210");
  });

  it("strips a leading 91 (no plus)", () => {
    assert.equal(normalizeIndianPhone("91-9876543210"), "9876543210");
    assert.equal(normalizeIndianPhone("919876543210"), "9876543210");
  });

  it("strips a leading trunk-prefix 0", () => {
    assert.equal(normalizeIndianPhone("098765 43210"), "9876543210");
    assert.equal(normalizeIndianPhone("09876543210"), "9876543210");
  });

  it("never mistakes a plain 10-digit number starting with 9 for a 91-prefixed one", () => {
    // 10 digits total, starts "9" then "1" — not a 12-digit +91 form, so
    // it must be read as its own valid mobile number, unchanged.
    assert.equal(normalizeIndianPhone("9198765432"), "9198765432");
  });

  it("rejects the exact garbage phone from the live audit (\"12345\")", () => {
    assert.equal(normalizeIndianPhone("12345"), null);
  });

  it("rejects a number with the wrong leading digit (0-5 are not mobile ranges)", () => {
    assert.equal(normalizeIndianPhone("5876543210"), null);
    assert.equal(normalizeIndianPhone("1234567890"), null);
  });

  it("rejects non-numeric input, empty input, and wrong lengths", () => {
    assert.equal(normalizeIndianPhone("abcdefghij"), null);
    assert.equal(normalizeIndianPhone(""), null);
    assert.equal(normalizeIndianPhone("98765"), null);
    assert.equal(normalizeIndianPhone("987654321099"), null);
  });
});

describe("normalizeIndianPincode", () => {
  it("accepts a bare 6-digit PIN code starting 1-9", () => {
    assert.equal(normalizeIndianPincode("500032"), "500032");
    assert.equal(normalizeIndianPincode("110001"), "110001");
  });

  it("strips internal spaces", () => {
    assert.equal(normalizeIndianPincode("110 001"), "110001");
    assert.equal(normalizeIndianPincode("500 032"), "500032");
  });

  it("rejects the exact garbage pincode from the live audit (\"AB123\")", () => {
    assert.equal(normalizeIndianPincode("AB123"), null);
  });

  it("rejects a PIN code starting with 0 (India Post never issues one)", () => {
    assert.equal(normalizeIndianPincode("012345"), null);
  });

  it("rejects the wrong number of digits", () => {
    assert.equal(normalizeIndianPincode("12345"), null);
    assert.equal(normalizeIndianPincode("1234567"), null);
    assert.equal(normalizeIndianPincode(""), null);
  });
});
