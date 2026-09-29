import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../../next.config";
import { fabricSeoRedirects } from "@/data/seo-landing-pages";

/**
 * release-hardening F-156: these legacy fabric-tech SEO URLs used to
 * permanently redirect straight into /fabric-technology/<slug>, which
 * 404s while the Fabric Technology hub is disabled (the default — see
 * src/app/fabric-technology/[slug]/page.tsx) — a 308 to a 404 wastes
 * whatever link equity the old URL had. Asserts the real redirect map
 * next.config.ts serves, not a hand-copied one, so it breaks if the fix
 * ever regresses back to redirecting through the flag-gated hub.
 */
describe("next.config.ts redirects — legacy fabric-tech URLs (F-156)", () => {
  it("never redirects a fabric SEO URL to a /fabric-technology/<slug> detail page", async () => {
    const redirects = await nextConfig.redirects!();
    for (const legacy of fabricSeoRedirects) {
      const rule = redirects.find((r) => r.source === legacy.path);
      assert.ok(rule, `expected a redirect rule for ${legacy.path}`);
      assert.ok(
        !rule!.destination.startsWith("/fabric-technology/"),
        `${legacy.path} must not redirect to ${rule!.destination} — that 404s while ` +
          "Fabric Technology is disabled",
      );
      assert.equal(rule!.permanent, true);
    }
  });

  it("sends the 4-way-stretch URL to its live guide article", async () => {
    const redirects = await nextConfig.redirects!();
    const rule = redirects.find((r) => r.source === "/4-way-stretch-scrubs");
    assert.equal(rule?.destination, "/guides/what-is-4-way-stretch-fabric");
  });

  it("falls back the other fabric SEO URLs to /shop, a page that is always live", async () => {
    const redirects = await nextConfig.redirects!();
    const rule = redirects.find((r) => r.source === "/sustainable-medical-apparel");
    assert.equal(rule?.destination, "/shop");
  });
});
