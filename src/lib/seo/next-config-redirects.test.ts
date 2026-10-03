import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../../next.config";
import { fabricSeoRedirects, resolveLegacyGuidePath, seoLandingPages } from "@/data/seo-landing-pages";

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

/**
 * release-hardening F-048: guides' shopHref/secondaryHref used to name another
 * guide by its legacy root path (/doctor-scrubs, /nurse-uniforms, ...), which
 * next.config.ts redirects to /guides/<slug> — so a click paid a 308 hop and a
 * crawler followed a redirect from the site's own internal links.
 */
describe("guide CTA links point at final URLs (F-048)", () => {
  it("keeps fixed guide CTAs on durable pages, even when a blog post is unpublished", () => {
    for (const page of seoLandingPages) {
      assert.ok(
        !page.secondaryHref?.startsWith("/blog/"),
        `guide "${page.slug}" hard-links to a database-managed blog post`,
      );
      assert.notEqual(
        page.secondaryHref,
        `/guides/${page.slug}`,
        `guide "${page.slug}" links back to itself`,
      );
    }
  });

  it("maps a legacy guide path to its /guides/<slug> page, and /hospital-uniforms to the section landing", () => {
    assert.equal(resolveLegacyGuidePath("/doctor-scrubs"), "/guides/doctor-scrubs");
    assert.equal(resolveLegacyGuidePath("/nurse-uniforms"), "/guides/nurse-uniforms");
    assert.equal(resolveLegacyGuidePath("/hospital-uniforms"), "/for-hospitals");
  });

  it("leaves every other href alone", () => {
    for (const href of ["/shop", "/category/scrub-sets", "/bulk-orders", "/blog/how-to-choose-medical-scrubs", "/guides/doctor-scrubs"]) {
      assert.equal(resolveLegacyGuidePath(href), href);
    }
  });

  it("after resolution, no guide CTA targets a URL next.config.ts redirects", async () => {
    const redirects = await nextConfig.redirects!();
    const redirectSources = new Set(redirects.map((rule) => rule.source));
    for (const page of seoLandingPages) {
      for (const href of [page.shopHref, page.secondaryHref]) {
        if (!href) continue;
        const resolved = resolveLegacyGuidePath(href);
        assert.ok(
          !redirectSources.has(resolved),
          `guide "${page.slug}" links to ${href}, which still redirects (${resolved})`,
        );
      }
    }
  });
});
