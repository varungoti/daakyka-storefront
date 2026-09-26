import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { seedCatalog } from "../../prisma/seed-catalog";
import {
  getCategoryTree,
  getProductByHandle,
  getProducts,
  getProductsByCategory,
  PRODUCTS_CACHE_TAG,
  productCacheTag,
  revalidateProductStockForVariants,
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
      // Note: this deliberately does NOT compare absolute
      // db.category/product/productVariant.count() before vs. after.
      // Those tables are shared with other integration test files (e.g.
      // catalog-admin.test.ts, catalog-products.test.ts) that create and
      // delete their own rows concurrently against the same dev database
      // (node's test runner executes test files concurrently by
      // default), so an absolute count can legitimately shift between the
      // two reads for reasons that have nothing to do with seedCatalog's
      // idempotency. seedCatalog's own summary — computed inside a single
      // call, not via separate count() round trips — is the real signal.
      const summary = await seedCatalog(db);

      assert.equal(summary.productsCreated, 0, "second run should create no new products");
      assert.equal(summary.variantsCreated, 0, "second run should create no new variants");
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
      // Falls back to the neutral placeholder when no ProductImage rows
      // exist, or resolves to a real (possibly Phase E3 AI-generated)
      // image otherwise — either way, mapping must always produce some
      // valid, non-empty image reference.
      assert.ok(
        product!.image === "/placeholder-product.svg" || product!.image.startsWith("/cdn/"),
        `expected a placeholder or /cdn/ image, got: ${product!.image}`,
      );

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

  describe("unknown category slug", () => {
    it("returns an empty result for a slug with no DB equivalent, instead of the legacy seed catalog (F-003)", async () => {
      // "bespoke" only ever existed in the old src/data/products.ts seed
      // catalog — fabricated ratings, PDP links that 404, and an "Add to
      // Cart" checkout could never resolve, all live on production via
      // /shop/bespoke. There's no real "bespoke" DB category, so this must
      // now render an honest empty result, not that fake data.
      const results = await getProductsByCategory("bespoke");
      assert.deepEqual(results, []);
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

  describe("deactivating a parent category hides its still-active child (F-099)", () => {
    const parentSlug = "release-hardening-f099-parent";
    const childSlug = "release-hardening-f099-child";
    const productSlug = "release-hardening-f099-product";
    // Kept ACTIVE for this whole block so getProducts()'s unfiltered
    // listing always has at least one *other* real, visible product —
    // otherwise, once the orphaned test product below is the only ACTIVE
    // row left in an isolated test DB, the listing legitimately returns
    // zero rows and getProducts() takes that as "the DB has no catalog at
    // all yet" and falls back to the legacy seed data (see its own doc
    // comment), which would pass this test for the wrong reason.
    const unrelatedActiveSlug = "classic-unisex-scrub-set";
    let parentId: string;
    let childId: string;

    before(async () => {
      await db.product.update({ where: { slug: unrelatedActiveSlug }, data: { status: "ACTIVE" } });
      const parent = await db.category.create({
        data: { slug: parentSlug, name: "F-099 Test Parent", section: "GENERAL", active: true, sortOrder: 9999 },
      });
      parentId = parent.id;
      const child = await db.category.create({
        data: {
          slug: childSlug,
          name: "F-099 Test Child",
          section: "GENERAL",
          active: true,
          sortOrder: 9999,
          parentId,
        },
      });
      childId = child.id;
      await db.product.create({
        data: { slug: productSlug, name: "F-099 Test Product", categoryId: childId, status: "ACTIVE", price: 999 },
      });
    });

    after(async () => {
      await db.product.deleteMany({ where: { slug: productSlug } });
      await db.category.deleteMany({ where: { slug: { in: [childSlug, parentSlug] } } });
      await db.product.update({ where: { slug: unrelatedActiveSlug }, data: { status: "DRAFT" } });
    });

    it("the active child is reachable, and its product listed, while the parent is active", async () => {
      const tree = await getCategoryTree();
      const parent = tree.find((c) => c.slug === parentSlug);
      assert.ok(parent, "expected the parent to be a visible root");
      assert.ok(parent!.children.some((c) => c.slug === childSlug), "expected the child under the parent");

      const results = await getProductsByCategory(childSlug);
      assert.ok(results.some((p) => p.handle === productSlug));
    });

    it("deactivating the parent drops the child from the tree, and its product from both category and top-level listings", async () => {
      await db.category.update({ where: { id: parentId }, data: { active: false } });
      try {
        const tree = await getCategoryTree();
        assert.ok(!tree.some((c) => c.slug === parentSlug), "deactivated parent must not be a root");
        assert.ok(
          !tree.some((c) => c.children.some((child) => child.slug === childSlug)),
          "the still-active child must not be reachable anywhere in the tree (no promotion to root)",
        );

        // getCategoryBySlug (which getProductsByCategory uses) can no
        // longer find the orphaned child at all, so this returns [] rather
        // than the child's products.
        const byCategory = await getProductsByCategory(childSlug);
        assert.deepEqual(byCategory, []);

        // The top-level listing must not leak the orphaned child's product
        // either — this is the part that `category: { active: true }`
        // (only the product's *own* category) used to miss, since the
        // child's own `active` flag never changed.
        const all = await getProducts();
        assert.ok(!all.some((p) => p.handle === productSlug), "orphaned child's product must not leak into getProducts()");
      } finally {
        await db.category.update({ where: { id: parentId }, data: { active: true } });
      }
    });
  });

  describe("revalidateProductStockForVariants resolves variant ids to product slugs (F-017)", () => {
    it("revalidates exactly the product tag (and the broad products tag) for the given variant's product", async () => {
      const variant = await db.productVariant.findFirst({
        where: { product: { slug: "classic-unisex-scrub-set" } },
      });
      assert.ok(variant, "expected classic-unisex-scrub-set to have at least one seeded variant");

      const calls: Array<[string, string | { expire: number }]> = [];
      await revalidateProductStockForVariants([variant!.id], (tag, profile) => {
        calls.push([tag, profile]);
      });

      assert.deepEqual(calls, [
        [productCacheTag("classic-unisex-scrub-set"), { expire: 0 }],
        [PRODUCTS_CACHE_TAG, "max"],
      ]);
    });

    it("revalidates nothing (and never throws) for a variant id that doesn't exist", async () => {
      const calls: unknown[] = [];
      await assert.doesNotReject(
        revalidateProductStockForVariants(["does-not-exist"], (...args) => calls.push(args)),
      );
      assert.deepEqual(calls, []);
    });
  });
});
