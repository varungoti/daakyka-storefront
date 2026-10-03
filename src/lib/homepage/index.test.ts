import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { setNodeEnv } from "../../../tests/helpers/env";
import {
  HOMEPAGE_CACHE_TAG,
  legacyHeroToSlide,
  revalidateHomepageCache,
  validateHomepageSectionContent,
} from "@/lib/homepage/index";
import type { HeroContent, HeroSlideContent, HeroSlidesContent } from "@/lib/homepage/index";

describe("validateHomepageSectionContent", () => {
  // F-370: a HomepageSection row written outside the validated PUT route
  // (migration, manual SQL, import script, incident-response surgery) can
  // be valid JSON but the wrong shape. The read path used to trust it with
  // a blind `as T` cast, which crashed both the public hero and the only
  // admin UI that could fix it. This is the exact malformed fixture from
  // the finding's live repro.
  const malformedHeroSlides = {
    slides: [{ id: "audit-bad", enabled: true }],
    autoAdvanceMs: 6000,
  };
  const fallback: HeroSlidesContent = { slides: [], autoAdvanceMs: 6000 };

  it("falls back to the default when the stored content fails schema validation", () => {
    const result = validateHomepageSectionContent("hero-slides", malformedHeroSlides, fallback);
    assert.deepEqual(result, fallback);
  });

  it("returns the parsed content unchanged when it matches the schema", () => {
    const valid: HeroSlidesContent = {
      slides: [
        {
          id: "s1",
          enabled: true,
          eyebrow: "Eyebrow",
          headline: "Headline",
          subheadline: "Subheadline",
          description: "Description",
          primaryCta: { label: "Shop", href: "/shop" },
          secondaryCta: { label: "Learn", href: "/learn" },
          image: null,
          secondaryImage: null,
        },
      ],
      autoAdvanceMs: 6000,
    };
    const result = validateHomepageSectionContent("hero-slides", valid, fallback);
    assert.deepEqual(result, valid);
  });

  it("does not throw and does not mutate the fallback reference", () => {
    const result = validateHomepageSectionContent("hero-slides", malformedHeroSlides, fallback);
    assert.notEqual(result, malformedHeroSlides);
    assert.deepEqual(fallback, { slides: [], autoAdvanceMs: 6000 });
  });
});

// F-370, defence in depth: validation on read keeps a malformed row away
// from the renderer, but the carousel itself must also degrade rather than
// throw on a slide that is missing its CTAs — a throw here takes the whole
// homepage down, not just the hero.
describe("HeroCarousel with a partial slide (F-370)", () => {
  const props = { autoAdvanceMs: 6000, trustStats: [], rating: "4.9", ratingLabel: "Rated by customers" };
  // next/image's dev-time host allow-list check is skipped under NODE_ENV=test
  // (the hero avatars are remote photos); the real value is restored after.
  const render = (slides: HeroSlideContent[]) => {
    const original = process.env.NODE_ENV;
    setNodeEnv("test");
    try {
      return renderToStaticMarkup(createElement(HeroCarousel, { ...props, slides }));
    } finally {
      setNodeEnv(original);
    }
  };
  const partialSlide = { id: "audit-bad", enabled: true } as unknown as HeroSlideContent;

  it("renders a slide with no CTAs and no images, falling back to a working Shop link", () => {
    const html = render([partialSlide]);
    assert.ok(html.includes('href="/shop"'));
    assert.match(html, /Shop now/);
  });

  it("omits the secondary CTA when it is missing or half-filled, instead of rendering a dead link", () => {
    const base = { id: "s1", enabled: true, headline: "H", primaryCta: { label: "Shop", href: "/shop" } };
    for (const secondaryCta of [undefined, {}, { label: "Learn more" }, { href: "/learn" }]) {
      const html = render([{ ...base, secondaryCta } as unknown as HeroSlideContent]);
      assert.doesNotMatch(html, /Learn more/);
      assert.ok(!html.includes('href="/learn"'));
    }
  });

  it("still renders a complete slide's own CTAs", () => {
    const slide = {
      id: "s1",
      enabled: true,
      headline: "H",
      primaryCta: { label: "Browse scrubs", href: "/scrubs" },
      secondaryCta: { label: "For hospitals", href: "/for-hospitals" },
    } as unknown as HeroSlideContent;
    const html = render([slide]);
    assert.ok(html.includes('href="/scrubs"'));
    assert.match(html, /Browse scrubs/);
    assert.ok(html.includes('href="/for-hospitals"'));
    assert.match(html, /For hospitals/);
  });
});

describe("revalidateHomepageCache", () => {
  it("invokes the revalidate function with the homepage tag and an immediate ({ expire: 0 }) profile", () => {
    // F-214 fix: "max" is stale-while-revalidate, so the owner's first
    // reload after Save still showed the old content. { expire: 0 } forces
    // the next read to be fresh.
    const calls: Array<[string, string | { expire?: number }]> = [];
    revalidateHomepageCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[HOMEPAGE_CACHE_TAG, { expire: 0 }]]);
  });

  it("swallows an error thrown by the revalidate function instead of throwing", () => {
    assert.doesNotThrow(() => {
      revalidateHomepageCache(() => {
        throw new Error("no static generation store in this context");
      });
    });
  });

  it("defaults to the real next/cache revalidateTag (throws outside a Next request scope, and that throw is caught)", () => {
    // No argument passed — exercises the real default. Outside an actual
    // Next.js server there's no static generation store, so the real
    // revalidateTag throws internally; revalidateHomepageCache must catch
    // it rather than let it propagate (this is what makes the function
    // safe to call from plain scripts/tests, per its own doc comment).
    assert.doesNotThrow(() => {
      revalidateHomepageCache();
    });
  });
});

describe("legacyHeroToSlide", () => {
  const hero: HeroContent = {
    eyebrow: "Welcome to DAAKYKA",
    headline: "Expertly Designed, Meticulously Crafted",
    subheadline: "Quality Uniforms & Linens for Pan India",
    description: "Hospital linens, medical scrubs, school uniforms, and corporate wear.",
    primaryCta: "Shop All Scrubs",
    secondaryCta: "Build Your Fit",
    rating: "",
    ratingLabel: "Hyderabad-Based · 9+ Years of Trusted Manufacturing",
  };

  it("carries every legacy hero field across to the equivalent slide field", () => {
    const slide = legacyHeroToSlide(hero, null, null);
    assert.equal(slide.eyebrow, hero.eyebrow);
    assert.equal(slide.headline, hero.headline);
    assert.equal(slide.subheadline, hero.subheadline);
    assert.equal(slide.description, hero.description);
    assert.equal(slide.enabled, true);
  });

  it("hardcodes the primary/secondary CTA links to match what production actually rendered (mixMatchEnabled was always false from src/app/page.tsx)", () => {
    const slide = legacyHeroToSlide(hero, null, null);
    assert.deepEqual(slide.primaryCta, { label: "Shop All Scrubs", href: "/shop" });
    assert.deepEqual(slide.secondaryCta, { label: "Build Your Fit", href: "/for-hospitals" });
  });

  it("takes the Kids-first fallback hero CTA to the Kids Wear landing page", () => {
    const slide = legacyHeroToSlide({ ...hero, primaryCta: "Shop Kids Wear" }, null, null);
    assert.deepEqual(slide.primaryCta, { label: "Shop Kids Wear", href: "/kids-wear" });
  });

  it("maps null site images to null slide images (renders the neutral placeholder)", () => {
    const slide = legacyHeroToSlide(hero, null, null);
    assert.equal(slide.image, null);
    assert.equal(slide.secondaryImage, null);
  });

  it("maps resolved site images to the slide's image/secondaryImage, tagged with their manifest slot as assetId", () => {
    const slide = legacyHeroToSlide(
      hero,
      { url: "https://cdn.example.com/hero-1.webp", alt: "Main hero photo" },
      { url: "https://cdn.example.com/hero-2.webp", alt: "Secondary hero photo" },
    );
    assert.deepEqual(slide.image, { assetId: "home.hero.1", url: "https://cdn.example.com/hero-1.webp", alt: "Main hero photo" });
    assert.deepEqual(slide.secondaryImage, {
      assetId: "home.hero.2",
      url: "https://cdn.example.com/hero-2.webp",
      alt: "Secondary hero photo",
    });
  });
});
