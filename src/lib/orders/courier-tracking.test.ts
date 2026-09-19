import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCourierTrackingUrl } from "@/lib/orders/courier-tracking";

/**
 * Release-hardening item 2 — see the doc comment in courier-tracking.ts
 * for why this allowlist is deliberately tiny (FedEx/DHL only, verified
 * live) and why every Indian domestic courier this store actually ships
 * with (Delhivery, Blue Dart, DTDC, etc.) falls back to null/copyable
 * text instead of a guessed link.
 */
describe("getCourierTrackingUrl", () => {
  it("builds a FedEx tracking URL, case/spacing-insensitively", () => {
    assert.equal(
      getCourierTrackingUrl("FedEx", "999999999999"),
      "https://www.fedex.com/fedextrack/?trknbr=999999999999",
    );
    assert.equal(
      getCourierTrackingUrl("Fed Ex", "123"),
      "https://www.fedex.com/fedextrack/?trknbr=123",
    );
    assert.equal(
      getCourierTrackingUrl("FEDEX", "123"),
      "https://www.fedex.com/fedextrack/?trknbr=123",
    );
  });

  it("builds a DHL tracking URL, including the 'DHL Express' variant", () => {
    assert.equal(
      getCourierTrackingUrl("DHL", "AWB123"),
      "https://www.dhl.com/in-en/home/tracking.html?tracking-id=AWB123",
    );
    assert.equal(
      getCourierTrackingUrl("DHL Express", "AWB123"),
      "https://www.dhl.com/in-en/home/tracking.html?tracking-id=AWB123",
    );
  });

  it("URL-encodes a tracking number that needs it", () => {
    const url = getCourierTrackingUrl("FedEx", "AWB #123/456 ");
    assert.equal(url, `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent("AWB #123/456")}`);
  });

  it("returns null for real Indian domestic couriers this store actually uses — not a guessed link", () => {
    for (const courier of ["Delhivery", "Blue Dart", "Bluedart", "DTDC", "Ecom Express", "XpressBees", "India Post", "Speed Post", "Ekart", "Shadowfax"]) {
      assert.equal(getCourierTrackingUrl(courier, "123456"), null, `${courier} should not produce a link`);
    }
  });

  it("returns null for an unrecognized/free-text courier value", () => {
    assert.equal(getCourierTrackingUrl("Local Rider", "123"), null);
    assert.equal(getCourierTrackingUrl("", "123"), null);
  });

  it("returns null when courier or trackingNumber is missing", () => {
    assert.equal(getCourierTrackingUrl(null, "123"), null);
    assert.equal(getCourierTrackingUrl(undefined, "123"), null);
    assert.equal(getCourierTrackingUrl("FedEx", null), null);
    assert.equal(getCourierTrackingUrl("FedEx", undefined), null);
    assert.equal(getCourierTrackingUrl("FedEx", ""), null);
    assert.equal(getCourierTrackingUrl("FedEx", "   "), null);
  });
});
