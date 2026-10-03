import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FEATURED_PRODUCT_SLUGS } from "../src/data/catalog/featured-products";
import { draftProducts } from "../src/data/catalog/draft-catalog";
import reviewedViews from "../src/data/media/generated-product-views.json";
import { applyKidsFirstMerchandising } from "./merchandising-correction";
import type { PrismaClient } from "../src/generated/prisma/client";

describe("kids-first merchandising", () => {
  it("selects twelve real products with two reviewed alternate views for every listed colour", () => {
    assert.equal(FEATURED_PRODUCT_SLUGS.length, 12);
    for (const slug of FEATURED_PRODUCT_SLUGS) {
      const product = draftProducts.find((item) => item.slug === slug);
      assert.ok(product?.featured, `${slug} must exist and be featured in fresh seeds`);
      for (const color of new Set(product.variants.map((variant) => variant.color))) {
        const views = reviewedViews.filter((view) => view.productSlug === slug && view.color === color);
        assert.ok(views.length >= 2, `${slug}/${color} needs two reviewed alternate views plus its source photo`);
      }
    }
  });

  it("reorders existing slides without rewriting their copy or custom media, then runs once", async () => {
    const original = [
      { id: "hospital-scrubs", headline: "Edited hospital copy", image: { assetId: "hospital-photo" } },
      { id: "custom", headline: "Admin custom slide" },
      { id: "school-uniforms", headline: "Edited school copy" },
      { id: "kids-wear", headline: "Edited kids copy", image: { assetId: "kids-photo" } },
    ];
    let marker = false;
    let content = JSON.stringify({ slides: original, autoAdvanceMs: 9500 });
    let featuredWrites = 0;
    const fakeDb = {
      siteSetting: {
        findUnique: async () => (marker ? { key: "done" } : null),
        create: async () => { marker = true; },
      },
      homepageSection: {
        findUnique: async () => ({ id: "hero", content }),
        update: async ({ data }: { data: { content: string } }) => { content = data.content; },
      },
      product: {
        updateMany: async ({ where }: { where: { slug: { in: string[] }; status: string; images: unknown } }) => {
          assert.deepEqual(where.slug.in, [...FEATURED_PRODUCT_SLUGS]);
          assert.equal(where.status, "ACTIVE");
          assert.ok(where.images);
          featuredWrites++;
          return { count: 9 };
        },
      },
      category: { updateMany: async () => ({ count: 1 }) },
    } as unknown as PrismaClient;

    assert.deepEqual(await applyKidsFirstMerchandising(fakeDb), { reorderedSlides: 4, reorderedCategories: 3, correctedHeroFallback: false, newlyFeatured: 9 });
    const result = JSON.parse(content);
    assert.deepEqual(result.slides.map((slide: { id: string }) => slide.id), [
      "kids-wear", "hospital-scrubs", "school-uniforms", "custom",
    ]);
    assert.equal(result.autoAdvanceMs, 9500);
    assert.deepEqual(result.slides.find((slide: { id: string }) => slide.id === "kids-wear").image, { assetId: "kids-photo" });
    assert.equal(await applyKidsFirstMerchandising(fakeDb), null);
    assert.equal(featuredWrites, 1);
  });
});
