import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractRequestAttribution } from "@/lib/analytics/attribution";

/**
 * F-318 fix (release-hardening schema-foundation): pure request ->
 * attribution mapping, no DB involved — see the module's own doc comment
 * for the two-source (own query string, then Referer header) precedence
 * rule this covers.
 */
describe("extractRequestAttribution", () => {
  it("reads utm_source/medium/campaign from the request's own query string", () => {
    const request = new Request(
      "https://daakyka.example/api/checkout?utm_source=instagram&utm_medium=social&utm_campaign=diwali",
    );
    const attribution = extractRequestAttribution(request);
    assert.equal(attribution.utmSource, "instagram");
    assert.equal(attribution.utmMedium, "social");
    assert.equal(attribution.utmCampaign, "diwali");
  });

  it("falls back to the Referer header's query string when the request URL has none", () => {
    const request = new Request("https://daakyka.example/api/checkout", {
      headers: { referer: "https://daakyka.example/shop?utm_source=google&utm_medium=cpc" },
    });
    const attribution = extractRequestAttribution(request);
    assert.equal(attribution.utmSource, "google");
    assert.equal(attribution.utmMedium, "cpc");
    assert.equal(attribution.utmCampaign, null);
  });

  it("the request's own query string wins over the Referer header's when both are present", () => {
    const request = new Request("https://daakyka.example/api/checkout?utm_source=own", {
      headers: { referer: "https://daakyka.example/shop?utm_source=referer" },
    });
    const attribution = extractRequestAttribution(request);
    assert.equal(attribution.utmSource, "own");
  });

  it("sets referrer to the Referer's origin+pathname, stripping its query string", () => {
    const request = new Request("https://daakyka.example/api/checkout", {
      headers: { referer: "https://daakyka.example/shop/scrubs?utm_source=x&token=secret" },
    });
    const attribution = extractRequestAttribution(request);
    assert.equal(attribution.referrer, "https://daakyka.example/shop/scrubs");
    assert.ok(!attribution.referrer!.includes("secret"), "must never leak the referrer's query string");
  });

  it("returns every field as null when there is nothing to attribute", () => {
    const request = new Request("https://daakyka.example/api/checkout");
    const attribution = extractRequestAttribution(request);
    assert.deepEqual(attribution, { utmSource: null, utmMedium: null, utmCampaign: null, referrer: null });
  });

  it("never throws on a malformed Referer header", () => {
    const request = new Request("https://daakyka.example/api/checkout", {
      headers: { referer: "not a url" },
    });
    assert.doesNotThrow(() => extractRequestAttribution(request));
    const attribution = extractRequestAttribution(request);
    assert.equal(attribution.referrer, null);
  });

  it("clips an oversized value instead of storing it unbounded", () => {
    const huge = "a".repeat(2000);
    const request = new Request(`https://daakyka.example/api/checkout?utm_source=${huge}`);
    const attribution = extractRequestAttribution(request);
    assert.ok(attribution.utmSource!.length <= 255);
  });

  it("treats a blank utm param as absent, not an empty string", () => {
    const request = new Request("https://daakyka.example/api/checkout?utm_source=");
    const attribution = extractRequestAttribution(request);
    assert.equal(attribution.utmSource, null);
  });
});
