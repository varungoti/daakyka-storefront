import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { policyMetadata } from "@/components/legal/policy-page";

/**
 * release-hardening F-147: every policy page used to inherit the root
 * layout's canonical (the homepage) because `policyMetadata()` returned
 * only {title, description} — the localhost/production crawl found
 * /returns, /terms, /shipping, /privacy-policy and /accessibility all
 * carrying <link rel="canonical" href=".../"> instead of their own URL.
 */
describe("policyMetadata", () => {
  it("sets a self-referencing canonical from the given path", () => {
    const metadata = policyMetadata("Returns", "Return policy.", "/returns");
    assert.equal(metadata.alternates?.canonical, "/returns");
  });

  it("sets openGraph.url to the same path (F-151)", () => {
    const metadata = policyMetadata("Terms", "Terms of service.", "/terms");
    assert.equal(metadata.openGraph?.url, "/terms");
  });

  it("keeps title and description", () => {
    const metadata = policyMetadata("Shipping", "Shipping info.", "/shipping");
    assert.equal(metadata.title, "Shipping");
    assert.equal(metadata.description, "Shipping info.");
  });
});
