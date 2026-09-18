import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MediaUsage } from "@/generated/prisma/client";
import type { AspectRatio, PromptPreset } from "@/lib/ai/prompt-presets";
import {
  IMAGE_MANIFEST,
  aspectClassName,
  blogPostImageSlot,
  categoryImageSlot,
  findDuplicateSlots,
  isManifestSlot,
  placeholderForAspect,
  toGenerationAspect,
  type ImageManifestEntry,
  type ManifestAspect,
} from "@/data/media/image-manifest";

const VALID_USAGES = new Set(Object.values(MediaUsage));
const VALID_PRESETS: Set<PromptPreset> = new Set([
  "product",
  "category-tile",
  "hero-banner",
  "hospital-scene",
  "school-scene",
  "kids-scene",
  "blog",
  "avatar",
  "how-to-measure",
]);
const VALID_ASPECTS: Set<ManifestAspect> = new Set(["square", "portrait", "landscape", "wide"]);

describe("IMAGE_MANIFEST structure", () => {
  it("is non-empty", () => {
    assert.ok(IMAGE_MANIFEST.length > 0);
  });

  it("every entry has a valid usage, preset, and aspect", () => {
    for (const entry of IMAGE_MANIFEST) {
      assert.ok(VALID_USAGES.has(entry.usage), `${entry.slot}: invalid usage ${entry.usage}`);
      assert.ok(VALID_PRESETS.has(entry.preset), `${entry.slot}: invalid preset ${entry.preset}`);
      assert.ok(VALID_ASPECTS.has(entry.aspect), `${entry.slot}: invalid aspect ${entry.aspect}`);
      assert.ok(entry.slot.trim().length > 0, "slot must not be blank");
      assert.ok(entry.label.trim().length > 0, `${entry.slot}: label must not be blank`);
    }
  });

  it("has no duplicate slot names", () => {
    assert.deepEqual(findDuplicateSlots(), []);
  });

  it("findDuplicateSlots actually detects a duplicate (sanity check the checker itself)", () => {
    const withDupe: ImageManifestEntry[] = [
      { slot: "a", usage: "BANNER", preset: "hero-banner", aspect: "wide", label: "A" },
      { slot: "a", usage: "SECTION", preset: "blog", aspect: "landscape", label: "A again" },
    ];
    assert.deepEqual(findDuplicateSlots(withDupe), ["a"]);
  });

  it("declares the required fixed slots from the plan", () => {
    const slots = new Set(IMAGE_MANIFEST.map((e) => e.slot));
    for (const required of [
      "home.hero.1",
      "home.hero.2",
      "home.hero.3",
      "home.tile.for-hospitals",
      "home.tile.school-uniforms",
      "home.tile.kids-wear",
      "home.tile.sale",
      "home.band.hospital",
      "home.band.school",
      "our-story.hero",
      "about.hero",
      "bulk-orders.hero",
      "contact.banner",
      "size-guide.how-to-measure",
    ]) {
      assert.ok(slots.has(required), `missing required slot: ${required}`);
    }
  });

  it("excludes the explicitly deferred slots (404, OG, favicon/manifest icons, logo)", () => {
    const slots = IMAGE_MANIFEST.map((e) => e.slot);
    for (const banned of ["404", "og", "favicon", "logo", "manifest-icon"]) {
      assert.ok(
        !slots.some((slot) => slot.toLowerCase().includes(banned)),
        `manifest should not declare a slot for "${banned}"`,
      );
    }
  });

  it("isManifestSlot only recognizes real static slots", () => {
    assert.equal(isManifestSlot("home.hero.1"), true);
    assert.equal(isManifestSlot("not-a-real-slot"), false);
    // Dynamic slots are intentionally not in the static set.
    assert.equal(isManifestSlot("category.for-hospitals"), false);
  });
});

describe("toGenerationAspect", () => {
  it("maps every AspectRatio to itself", () => {
    const identityCases: AspectRatio[] = ["square", "portrait", "landscape"];
    for (const aspect of identityCases) {
      assert.equal(toGenerationAspect(aspect), aspect);
    }
  });

  it("maps 'wide' down to 'landscape' (the widest size the image API supports)", () => {
    assert.equal(toGenerationAspect("wide"), "landscape");
  });
});

describe("aspectClassName / placeholderForAspect", () => {
  it("returns a distinct Tailwind class for every aspect", () => {
    const classes = new Set(
      (["square", "portrait", "landscape", "wide"] as ManifestAspect[]).map(aspectClassName),
    );
    assert.equal(classes.size, 4);
  });

  it("square and portrait share the product placeholder; landscape and wide get their own", () => {
    assert.equal(placeholderForAspect("square"), "/placeholder-product.svg");
    assert.equal(placeholderForAspect("portrait"), "/placeholder-product.svg");
    assert.equal(placeholderForAspect("landscape"), "/placeholder-scene.svg");
    assert.equal(placeholderForAspect("wide"), "/placeholder-banner.svg");
  });
});

describe("dynamic slot helpers", () => {
  it("categoryImageSlot builds a category.{slug} slot with a valid preset/aspect/usage", () => {
    const entry = categoryImageSlot({ slug: "for-hospitals", name: "For Hospitals" });
    assert.equal(entry.slot, "category.for-hospitals");
    assert.ok(VALID_USAGES.has(entry.usage));
    assert.ok(VALID_PRESETS.has(entry.preset));
    assert.ok(VALID_ASPECTS.has(entry.aspect));
  });

  it("blogPostImageSlot builds a blog.post.{slug} slot with a valid preset/aspect/usage", () => {
    const entry = blogPostImageSlot({ slug: "fabric-care-101", title: "Fabric Care 101" });
    assert.equal(entry.slot, "blog.post.fabric-care-101");
    assert.ok(VALID_USAGES.has(entry.usage));
    assert.ok(VALID_PRESETS.has(entry.preset));
    assert.ok(VALID_ASPECTS.has(entry.aspect));
  });

  it("dynamic slots never collide with a static manifest slot", () => {
    const staticSlots = new Set(IMAGE_MANIFEST.map((e) => e.slot));
    assert.ok(!staticSlots.has(categoryImageSlot({ slug: "kids-wear", name: "Kids Wear" }).slot) || false);
    // The real assertion: dynamic slot names always carry a namespaced
    // prefix ("category."/"blog.post.") that no static entry uses.
    for (const entry of IMAGE_MANIFEST) {
      assert.ok(!entry.slot.startsWith("category."));
      assert.ok(!entry.slot.startsWith("blog.post."));
    }
  });
});
