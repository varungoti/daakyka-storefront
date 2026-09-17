import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { seedCatalog } from "../../prisma/seed-catalog";
import {
  getCategoryTree,
  getProductByHandle,
  getProducts,
  getProductsByCategory,
} from "@/lib/products";

/**
 * Phase B3 (products data layer) + E1 (draft catalog seed) integration
 * tests, run against the real local dev Postgres (see AGENTS.md / the
 * repo's other tests/integration/*.test.ts files, which do the same).
 *
 * These tests only ever flip specific, already-DRAFT seeded products to
 * ACTIVE and back in `after()` hooks — they never touch any other data,
 * so this is safe to run against the shared dev database and leaves it
 * exactly as found (matching the convention in site-settings.test.ts).
 */

describe("catalog (Phase B3 + E1) integration", () => {
  before(async () => {
    // Idempotent, create-only — safe to call even if the catalog was
    // already seeded (e.g. by `npm run db:seed:catalog` locally).
    await seedCatalog(db);
  });

  describe("seed-catalog idempotency", () => {
    it("running seedCatalog a second time creates nothing new", async () => {
      const categoriesBefore = await db.category.count();
      const productsBefore = await db.product.count();
      const variantsBefore = await db.productVariant.count();
      const sizeChartsBefore = await db.sizeChart.count();

      const summary = await seedCatalog(db);

      assert.equal(summary.productsCreated, 0, "second run should create no new products");
      assert.equal(summary.variantsCreated, 0, "second run should create no new variants");
      assert.equal(await db.category.count(), categoriesBefore);
      assert.equal(await db.product.count(), productsBefore);
      assert.equal(await db.productVariant.count(), variantsBefore);
      assert.equal(await db.sizeChart.count(), sizeChartsBefore);
    });
  });

  describe("DRAFT visibility and product mapping", () => {
    const activeSlug = "classic-unisex-scrub-set";
    const draftSlug = "antimicrobial-scrub-set";

    before(async () => {
      await db.product.update({ where: { slug: activeSlug }, data: { status: "ACTIVE" } });
      await db.product.update({ where: { slug: draftSlug }, data: { status: "DRAFT" } });
    });

    after(async () => {
      // Restore to DRAFT — the plan's default for a freshly-seeded
      // catalog awaiting client review.
      await db.product.update({ where: { slug: activeSlug }, data: { status: "DRAFT" } });
    });

    it("getProducts() only returns ACTIVE products", async () => {
      const all = await getProducts();
      const handles = all.map((p) => p.handle);
      assert.ok(handles.includes(activeSlug), "expected the ACTIVE product to be visible");
      assert.ok(!handles.includes(draftSlug), "expected the DRAFT product to stay hidden");
    });

    it("getProductByHandle() returns null for a DRAFT product", async () => {
      assert.equal(await getProductByHandle(draftSlug), null);
    });

    it("getProductByHandle() maps variants, sizes, colors and category fields for an ACTIVE product", async () => {
      const product = await getProductByHandle(activeSlug);
      assert.ok(product, "expected the ACTIVE product to be found");
      assert.ok(product!.variants && product!.variants.length > 0);
      assert.ok(product!.sizes.length > 0);
      assert.ok(product!.colors.length > 0);
      assert.equal(product!.categorySlug, "scrub-sets");
      assert.equal(product!.categoryName, "Scrub Sets");
      assert.equal(product!.section, "HOSPITAL");
      assert.equal(typeof product!.price, "number");
      assert.ok(product!.price > 0);
      assert.equal(product!.reviewCount, 0);
      assert.equal(product!.ratingAverage, 0);
      // No ProductImage rows exist yet (AI image generation is a later
      // phase) — mapping should fall back to the neutral placeholder.
      assert.equal(product!.image, "/placeholder-product.svg");

      const variant = product!.variants!.find((v) => v.size && v.color);
      assert.ok(variant, "expected at least one variant with size + color");
      assert.equal(typeof variant!.stock, "number");
    });
  });

  describe("category descendant filtering", () => {
    // scrub-sets is a direct child of for-hospitals; bedsheets is a
    // grandchild (for-hospitals -> hospital-linens -> bedsheets) — this
    // exercises multi-level descendant resolution, not just one level.
    const scrubSetSlug = "classic-unisex-scrub-set";
    const bedsheetSlug = "cotton-hospital-bedsheet";

    before(async () => {
      await db.product.updateMany({
        where: { slug: { in: [scrubSetSlug, bedsheetSlug] } },
        data: { status: "ACTIVE" },
      });
    });

    after(async () => {
      await db.product.updateMany({
        where: { slug: { in: [scrubSetSlug, bedsheetSlug] } },
        data: { status: "DRAFT" },
      });
    });

    it("getProductsByCategory('for-hospitals') includes products from nested descendant categories", async () => {
      const results = await getProductsByCategory("for-hospitals");
      const handles = results.map((p) => p.handle);
      assert.ok(handles.includes(scrubSetSlug), "expected the direct-child category's product");
      assert.ok(
        handles.includes(bedsheetSlug),
        "expected the grandchild category's (hospital-linens > bedsheets) product",
      );
    });

    it("getProductsByCategory('scrub-sets') does not include products from a sibling category", async () => {
      const results = await getProductsByCategory("scrub-sets");
      const handles = results.map((p) => p.handle);
      assert.ok(handles.includes(scrubSetSlug));
      assert.ok(!handles.includes(bedsheetSlug));
    });
  });

  describe("legacy category fallback", () => {
    it("falls back to the legacy seed data for a category slug that has no DB equivalent", async () => {
      // "bespoke" only ever existed in the old src/data/products.ts seed
      // catalog — /shop/bespoke still links to it, so it must keep
      // working rather than silently going empty.
      const results = await getProductsByCategory("bespoke");
      assert.ok(results.length > 0);
      assert.ok(results.every((p) => p.category === "bespoke"));
    });
  });

  describe("category tree", () => {
    it("getCategoryTree() surfaces the seeded section parents with nested children", async () => {
      const tree = await getCategoryTree();
      const hospitals = tree.find((c) => c.slug === "for-hospitals");
      assert.ok(hospitals, "expected a for-hospitals top-level category");
      assert.equal(hospitals!.section, "HOSPITAL");
      const linens = hospitals!.children.find((c) => c.slug === "hospital-linens");
      assert.ok(linens, "expected hospital-linens as a child of for-hospitals");
      assert.ok(
        linens!.children.some((c) => c.slug === "bedsheets"),
        "expected bedsheets as a child of hospital-linens",
      );

      const corporate = tree.find((c) => c.slug === "corporate-uniforms");
      assert.ok(corporate, "expected the hidden corporate-uniforms category to still be in the tree");
      assert.equal(corporate!.showInMenu, false);
    });
  });
});
