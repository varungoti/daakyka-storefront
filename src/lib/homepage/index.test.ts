import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOMEPAGE_CACHE_TAG, legacyHeroToSlide, revalidateHomepageCache } from "@/lib/homepage/index";
import type { HeroContent } from "@/lib/homepage/index";

describe("revalidateHomepageCache", () => {
  it("invokes the revalidate function with the homepage tag and the 'max' profile", () => {
    const calls: Array<[string, string]> = [];
    revalidateHomepageCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[HOMEPAGE_CACHE_TAG, "max"]]);
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
