import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkShippingInput } from "@/lib/admin/shipping-input";

describe("checkShippingInput (F-165)", () => {
  it("accepts normal amounts without asking for confirmation", () => {
    const result = checkShippingInput({ flatRate: "99", freeAbove: "8000" });
    assert.deepEqual(result, { ok: true, flatRate: 99, freeAbove: 8000, confirmMessage: null });
  });

  it("blocks a cleared field instead of turning it into 0", () => {
    const flatBlank = checkShippingInput({ flatRate: "", freeAbove: "8000" });
    assert.equal(flatBlank.ok, false);
    const freeBlank = checkShippingInput({ flatRate: "99", freeAbove: "   " });
    assert.equal(freeBlank.ok, false);
    if (!freeBlank.ok) assert.match(freeBlank.error, /free shipping above/);
  });

  it("blocks non-numeric and negative amounts", () => {
    assert.equal(checkShippingInput({ flatRate: "abc", freeAbove: "8000" }).ok, false);
    assert.equal(checkShippingInput({ flatRate: "99", freeAbove: "-1" }).ok, false);
    assert.equal(checkShippingInput({ flatRate: "99", freeAbove: "Infinity" }).ok, false);
  });

  it("asks for confirmation when free-shipping-above is 0 (free on every order)", () => {
    const result = checkShippingInput({ flatRate: "99", freeAbove: "0" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.freeAbove, 0);
      assert.match(result.confirmMessage ?? "", /free on every order/);
    }
  });

  it("asks for confirmation when the flat rate is 0", () => {
    const result = checkShippingInput({ flatRate: "0", freeAbove: "8000" });
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.confirmMessage ?? "", /flat rate of ₹0/);
  });
});
