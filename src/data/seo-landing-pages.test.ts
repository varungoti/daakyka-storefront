import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { seoLandingPages } from "@/data/seo-landing-pages";
import { blogPosts } from "@/data/blog";

/**
 * release-hardening audit F-093 / F-148: these guides and blog posts used to
 * advertise a Mix & Match builder and fabric properties (4-way stretch,
 * anti-microbial, liquid-repellent, moisture-wicking) the live catalogue
 * doesn't have, and pointed "Shop ..." CTAs at legacy seed-catalog slugs
 * (?category=tops/bottoms/sets, /shop/bespoke, ?fabric=) that always
 * rendered an empty grid. Regression tests for both.
 */

// Body copy — the fields SeoLandingLayout actually prints to shoppers (and
// what its FAQPage JSON-LD is built from). Deliberately excludes
// shopLabel/secondaryLabel: those are rewritten at request time by
// resolvePageLinks() in src/app/guides/[slug]/page.tsx to "Shop Now"
// whenever the page they'd otherwise open (mix-and-match, fabric-technology)
// is disabled, so a label can legitimately say "Mix & Match" only while
// that feature is actually live.
function bodyText(page: (typeof seoLandingPages)[number]): string {
  return [
    page.h1,
    page.intro,
    ...page.bullets,
    ...(page.buyingGuide ?? []),
    ...page.faqs.flatMap((f) => [f.question, f.answer]),
  ].join(" \n ");
}

const MIX_MATCH_PATTERN = /mix\s*&\s*match/i;
// The store's real catalogue has no 4-way/2-way stretch, anti-microbial, or
// liquid-repellent products (see src/lib/products/index.ts's
// deriveFabricTech — no seeded product tag ever sets these). Body copy must
// not claim them. "what-is-4-way-stretch-fabric" is the one guide allowed
// to use the term "4-way stretch" itself, since it's explicitly reframed as
// generic fabric-technology education, not a claim about DAAKYKA's own
// scrubs (F-148 fix guidance).
const UNSUPPORTED_FABRIC_PATTERN = /anti-?microbial|liquid[- ]repellent|moisture-wicking/i;
const FOUR_WAY_STRETCH_PATTERN = /4-way stretch/i;
const LEGACY_SEED_CATEGORY_HREF = /\/shop\?category=(tops|bottoms|sets|jackets|accessories)\b/;

describe("seo landing pages content accuracy (F-093, F-148)", () => {
  it("no guide's body copy promises the disabled Mix & Match builder", () => {
    for (const page of seoLandingPages) {
      assert.ok(
        !MIX_MATCH_PATTERN.test(bodyText(page)),
        `guide "${page.slug}" body copy still mentions Mix & Match`,
      );
    }
  });

  it("no guide's body copy claims fabric properties the catalogue doesn't have", () => {
    for (const page of seoLandingPages) {
      const text = bodyText(page);
      assert.ok(
        !UNSUPPORTED_FABRIC_PATTERN.test(text),
        `guide "${page.slug}" body copy claims an unsupported fabric property`,
      );
      if (page.slug !== "what-is-4-way-stretch-fabric") {
        assert.ok(
          !FOUR_WAY_STRETCH_PATTERN.test(text),
          `guide "${page.slug}" body copy claims 4-way stretch, which the catalogue doesn't have`,
        );
      }
    }
  });

  it("no guide claims a sizing range wider than the catalogue actually stocks", () => {
    for (const page of seoLandingPages) {
      assert.ok(
        !/XXS/i.test(bodyText(page)) && !/5XL/i.test(bodyText(page)),
        `guide "${page.slug}" claims a size the catalogue doesn't stock`,
      );
    }
  });

  it("every 'Shop ...' CTA points at a real route, not a legacy seed-catalog filter", () => {
    for (const page of seoLandingPages) {
      for (const href of [page.shopHref, page.secondaryHref].filter(
        (h): h is string => Boolean(h),
      )) {
        assert.ok(
          !LEGACY_SEED_CATEGORY_HREF.test(href),
          `guide "${page.slug}" links to a legacy seed-catalog category filter: ${href}`,
        );
        assert.ok(
          href !== "/shop/bespoke",
          `guide "${page.slug}" links to /shop/bespoke, which has no real catalogue behind it`,
        );
        assert.ok(
          !href.includes("fabric=4-way-stretch"),
          `guide "${page.slug}" links to a fabric filter with zero matching products: ${href}`,
        );
      }
    }
  });

  it("every guide sets a real productCategory (so its product row isn't the site-wide best-sellers fallback)", () => {
    for (const page of seoLandingPages) {
      assert.ok(
        page.productCategory !== undefined,
        `guide "${page.slug}" has no productCategory, so it falls back to site-wide best sellers`,
      );
    }
  });
});

describe("blog post content accuracy (F-148)", () => {
  it("no blog post claims fabric properties the catalogue doesn't have", () => {
    for (const post of blogPosts) {
      const text = [post.excerpt, ...post.content].join(" \n ");
      assert.ok(
        !UNSUPPORTED_FABRIC_PATTERN.test(text) && !FOUR_WAY_STRETCH_PATTERN.test(text),
        `blog post "${post.slug}" claims an unsupported fabric property`,
      );
    }
  });
});
