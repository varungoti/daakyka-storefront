import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  archiveProduct,
  createProduct,
  deleteProduct,
  duplicateProduct,
  getProductForAdmin,
  InvalidCompareAtPriceError,
  listProductsForAdmin,
  performBulkAction,
  ProductCategoryNotFoundError,
  ProductDeleteBlockedError,
  ProductImageNotFoundError,
  ProductNotDraftError,
  ProductNotFoundError,
  ProductNotPublishableError,
  ProductSlugConflictError,
  ProductStatusPermissionError,
  publishProduct,
  removeProductImage,
  reorderProductImages,
  replaceVariants,
  setImageColor,
  unpublishProduct,
  unarchiveProduct,
  updateImageAlt,
  updateProduct,
  VariantOwnershipError,
  VariantStockConflictError,
} from "@/lib/catalog/products";
import { DuplicateVariantKeyError } from "@/lib/catalog/product-validation";
import { buildSkuOwnership, commitProductImport, dryRunProductImport, exportProductsCsv } from "@/lib/catalog/product-import";
import { IMPORT_COLUMNS, parseCsv, stringifyCsv } from "@/lib/catalog/csv";
import { GET as getProducts, POST as postProduct } from "@/app/api/admin/products/route";
import { DELETE as deleteProductRoute, GET as getProductRoute, PATCH as patchProductRoute } from "@/app/api/admin/products/[id]/route";
import { POST as bulkRoute } from "@/app/api/admin/products/bulk/route";
import { POST as publishRoute } from "@/app/api/admin/products/[id]/publish/route";
import { POST as variantsRoute } from "@/app/api/admin/products/[id]/variants/route";
import { findAnyAdminId } from "../helpers/admin-user";
import { getProductByHandle, getProductsStrict } from "@/lib/products/index";

/**
 * Phase B1: product admin CRUD, exercised at the library layer
 * (src/lib/catalog/products.ts and product-import.ts) — same rationale as
 * tests/integration/catalog-admin.test.ts: requireAdminPermission's
 * getSession() needs a real Next.js request context, so the business
 * rules are tested directly, plus a 401/403 sweep of the route handlers.
 */

const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdOrderIds: string[] = [];

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
});

describe("products admin service (Phase B1)", () => {
  let adminId: string;
  let categoryId: string;
  let categorySlug: string;

  before(async () => {
    adminId = await findAnyAdminId();
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `Test Products Category ${unique}`, slug: `test-products-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);
    categoryId = category.id;
    categorySlug = category.slug;
  });

  it("createProduct generates a unique slug and persists the row", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Test Product ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);

    assert.equal(product.slug, `test-product-${unique}`);
    assert.equal(product.status, "DRAFT");
    assert.equal(Number(product.price), 500);
  });

  it("createProduct rejects a slug already used by another product", async () => {
    const unique = randomUUID().slice(0, 8);
    const first = await createProduct({ name: `Dup ${unique}`, categoryId, price: 100 }, adminId);
    createdProductIds.push(first.id);

    await assert.rejects(
      () => createProduct({ name: "Different name", slug: first.slug, categoryId, price: 100 }, adminId),
      ProductSlugConflictError,
    );
  });

  it("createProduct rejects a category that doesn't exist", async () => {
    await assert.rejects(
      () => createProduct({ name: `No Category ${randomUUID().slice(0, 8)}`, categoryId: "nope", price: 100 }, adminId),
      ProductCategoryNotFoundError,
    );
  });

  it("createProduct rejects compareAtPrice <= price", async () => {
    await assert.rejects(
      () => createProduct({ name: `Bad Compare ${randomUUID().slice(0, 8)}`, categoryId, price: 500, compareAtPrice: 400 }, adminId),
      InvalidCompareAtPriceError,
    );
  });

  it("updateProduct throws ProductNotFoundError for an unknown id", async () => {
    await assert.rejects(() => updateProduct("does-not-exist", { name: "x" }, adminId), ProductNotFoundError);
  });

  it("publishProduct and unpublishProduct toggle status", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Publish Me ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);
    // F-028: publishProduct now rejects a product with no active variant.
    await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-PUB-${unique}`, stock: 5, active: true }], adminId);

    const published = await publishProduct(product.id, adminId);
    assert.equal(published.status, "ACTIVE");
    assert.ok((await getProductsStrict()).some((row) => row.handle === published.slug));
    assert.ok(await getProductByHandle(published.slug));

    const unpublished = await unpublishProduct(product.id, adminId);
    assert.equal(unpublished.status, "DRAFT");
    assert.ok(!(await getProductsStrict()).some((row) => row.handle === published.slug));
    assert.equal(await getProductByHandle(published.slug), null);

    const relisted = await publishProduct(product.id, adminId);
    assert.equal(relisted.status, "ACTIVE");
    assert.ok((await getProductsStrict()).some((row) => row.handle === published.slug));

    await archiveProduct(product.id, adminId);
    await assert.rejects(() => publishProduct(product.id, adminId), ProductNotPublishableError);
    await assert.rejects(() => unpublishProduct(product.id, adminId), ProductNotPublishableError);
    assert.ok(!(await getProductsStrict()).some((row) => row.handle === published.slug));
    await unarchiveProduct(product.id, adminId);
    assert.equal((await db.product.findUnique({ where: { id: product.id } }))?.status, "DRAFT");
  });

  it("an ordinary edit cannot turn an active listing into an unverified concept", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Verified Listing ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);
    await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-VER-${unique}`, stock: 5, active: true }], adminId);
    await publishProduct(product.id, adminId);

    await assert.rejects(() => updateProduct(product.id, { price: 0 }, adminId), ProductNotPublishableError);
    await assert.rejects(() => updateProduct(product.id, { tags: ["concept-pending-verification"] }, adminId), ProductNotPublishableError);
    assert.equal((await db.product.findUnique({ where: { id: product.id } }))?.status, "ACTIVE");
  });

  it("archiveProduct sets status to ARCHIVED", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Archive Me ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);

    const archived = await archiveProduct(product.id, adminId);
    assert.equal(archived.status, "ARCHIVED");
  });

  it("deleteProduct rejects a non-draft product", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Not Draft ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);
    await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-ND-${unique}`, stock: 5, active: true }], adminId);
    await publishProduct(product.id, adminId);

    await assert.rejects(() => deleteProduct(product.id, adminId), ProductNotDraftError);
  });

  describe("F-028: publishing requires at least one active variant", () => {
    it("publishProduct rejects a product with zero variants", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `No Variants ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);

      await assert.rejects(() => publishProduct(product.id, adminId), ProductNotPublishableError);
      assert.equal((await db.product.findUnique({ where: { id: product.id } }))?.status, "DRAFT");
    });

    it("publishProduct rejects a product whose only variants are inactive", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Inactive Only ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-INACT-${unique}`, stock: 5, active: false }], adminId);

      await assert.rejects(() => publishProduct(product.id, adminId), ProductNotPublishableError);
    });

    it("createProduct rejects status: ACTIVE outright (a brand-new product can't have variants yet)", async () => {
      const unique = randomUUID().slice(0, 8);
      await assert.rejects(
        () => createProduct({ name: `Direct Active ${unique}`, categoryId, price: 500, status: "ACTIVE" }, adminId),
        ProductNotPublishableError,
      );
    });

    it("updateProduct rejects a status:ACTIVE transition when the product has no active variant", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Update To Active ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);

      await assert.rejects(() => updateProduct(product.id, { status: "ACTIVE" }, adminId), ProductNotPublishableError);
    });

    it("updateProduct allows an ordinary edit that merely re-sends the current status", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Resend Status ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);

      // No variants at all — must not trip the publish guard, because the
      // status isn't actually changing.
      const updated = await updateProduct(product.id, { status: "DRAFT", shortDescription: "hello" }, adminId);
      assert.equal(updated.status, "DRAFT");
      assert.equal(updated.shortDescription, "hello");
    });

    it("performBulkAction's publish skips a zero-variant product, publishes the rest, and reports the skip", async () => {
      const unique = randomUUID().slice(0, 8);
      const withVariant = await createProduct({ name: `Bulk Pub Has Variant ${unique}`, categoryId, price: 500 }, adminId);
      const without = await createProduct({ name: `Bulk Pub No Variant ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(withVariant.id, without.id);
      await replaceVariants(withVariant.id, [{ size: "S", color: "Navy", sku: `DK-BPUB-${unique}`, stock: 5, active: true }], adminId);

      const result = await performBulkAction({ action: "publish", ids: [withVariant.id, without.id] }, adminId);

      assert.equal(result.affected, 1);
      assert.equal(result.skipped?.length, 1);
      assert.equal(result.skipped?.[0].id, without.id);
      assert.match(result.skipped?.[0].reason ?? "", /active variant/i);
      assert.equal((await db.product.findUnique({ where: { id: withVariant.id } }))?.status, "ACTIVE");
      assert.equal((await db.product.findUnique({ where: { id: without.id } }))?.status, "DRAFT");
    });
  });

  it("deleteProduct is blocked when the product has order items, and succeeds once there are none", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Has Orders ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);

    const variant = await db.productVariant.create({
      data: { productId: product.id, size: "M", color: "Navy", sku: `DK-TEST-${unique}-M-NAVY`, stock: 5 },
    });

    const order = await db.order.create({
      data: {
        number: `TEST-${unique}`,
        email: "test@example.com",
        shippingAddress: { line1: "1 Test St" },
        subtotal: 500,
        shipping: 0,
        total: 500,
      },
    });
    createdOrderIds.push(order.id);
    await db.orderItem.create({
      data: { orderId: order.id, variantId: variant.id, productName: product.name, unitPrice: 500, quantity: 1 },
    });

    const error = await deleteProduct(product.id, adminId).catch((e) => e);
    assert.ok(error instanceof ProductDeleteBlockedError);
    assert.equal((error as ProductDeleteBlockedError).orderCount, 1);

    // Clean up the order first, then the delete should succeed.
    await db.orderItem.deleteMany({ where: { orderId: order.id } });
    await db.order.delete({ where: { id: order.id } });
    createdOrderIds.splice(createdOrderIds.indexOf(order.id), 1);

    await deleteProduct(product.id, adminId);
    createdProductIds.splice(createdProductIds.indexOf(product.id), 1);
    assert.equal(await db.product.findUnique({ where: { id: product.id } }), null);
  });

  it("deleteProduct throws ProductNotFoundError for an unknown id", async () => {
    await assert.rejects(() => deleteProduct("does-not-exist", adminId), ProductNotFoundError);
  });

  it("replaceVariants rejects a duplicate (size,color) pair and otherwise persists the grid", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Variants ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);

    await assert.rejects(
      () =>
        replaceVariants(
          product.id,
          [
            { size: "S", color: "Navy", sku: `DK-A-${unique}`, stock: 1, active: true },
            { size: "S", color: "Navy", sku: `DK-B-${unique}`, stock: 1, active: true },
          ],
          adminId,
        ),
      DuplicateVariantKeyError,
    );

    await replaceVariants(
      product.id,
      [
        { size: "S", color: "Navy", sku: `DK-C-${unique}`, stock: 10, active: true },
        { size: "M", color: "Navy", sku: `DK-D-${unique}`, stock: 20, active: true },
      ],
      adminId,
    );

    const detail = await getProductForAdmin(product.id);
    assert.equal(detail.variants.length, 2);
  });

  describe("F-023/F-336: replaceVariants syncs instead of delete+recreate", () => {
    async function makeProductWithVariant(unique: string, stock = 5) {
      const product = await createProduct({ name: `Sync ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      const synced = await replaceVariants(
        product.id,
        [{ size: "M", color: "Navy", sku: `DK-SYNC-${unique}`, stock, active: true }],
        adminId,
      );
      return { product, variant: synced[0] };
    }

    it("re-saving an unchanged grid (by id) keeps the same variant id", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique);

      const resynced = await replaceVariants(
        product.id,
        [{ id: variant.id, size: "M", color: "Navy", sku: variant.sku, stock: variant.stock, active: true }],
        adminId,
      );

      assert.equal(resynced.length, 1);
      assert.equal(resynced[0].id, variant.id, "the variant id must survive an unchanged re-save");
    });

    it("a variant with order history is deactivated, not deleted, when dropped from the grid — the order item's link survives", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique);

      const order = await db.order.create({
        data: {
          number: `SYNCTEST-${unique}`,
          email: "sync-test@example.com",
          shippingAddress: { line1: "1 Test St" },
          subtotal: 500,
          shipping: 0,
          total: 500,
        },
      });
      createdOrderIds.push(order.id);
      await db.orderItem.create({
        data: { orderId: order.id, variantId: variant.id, productName: product.name, unitPrice: 500, quantity: 1 },
      });

      // A save whose grid drops the M/Navy row entirely (e.g. the admin
      // replaced it with a different size) must not hard-delete a variant
      // that an order references.
      await replaceVariants(
        product.id,
        [{ size: "L", color: "Navy", sku: `DK-SYNC2-${unique}`, stock: 5, active: true }],
        adminId,
      );

      const stillThere = await db.productVariant.findUnique({ where: { id: variant.id } });
      assert.ok(stillThere, "a variant referenced by an OrderItem must not be hard-deleted");
      assert.equal(stillThere?.active, false, "it should be deactivated instead");

      const orderItem = await db.orderItem.findFirst({ where: { orderId: order.id } });
      assert.equal(orderItem?.variantId, variant.id, "the order item's variant link must survive the save");
    });

    it("a variant with a pending back-in-stock subscription is deactivated, not deleted, and the subscription survives", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique, 0);

      const subscription = await db.backInStockSubscription.create({
        data: { productId: product.id, variantId: variant.id, email: `bis-${unique}@example.com` },
      });

      await replaceVariants(
        product.id,
        [{ size: "L", color: "Navy", sku: `DK-SYNC3-${unique}`, stock: 5, active: true }],
        adminId,
      );

      const stillThere = await db.productVariant.findUnique({ where: { id: variant.id } });
      assert.ok(stillThere, "a variant with a pending back-in-stock subscription must not be hard-deleted");
      assert.equal(stillThere?.active, false);

      const stillSubscribed = await db.backInStockSubscription.findUnique({ where: { id: subscription.id } });
      assert.ok(stillSubscribed, "the back-in-stock subscription must survive the save");
    });

    it("a genuinely new, never-persisted variant is created fresh, and an unreferenced dropped row is hard-deleted", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique);

      const synced = await replaceVariants(
        product.id,
        [{ size: "L", color: "Wine", sku: `DK-SYNC4-${unique}`, stock: 8, active: true }],
        adminId,
      );

      assert.equal(synced.length, 1);
      assert.notEqual(synced[0].id, variant.id);
      assert.equal(await db.productVariant.findUnique({ where: { id: variant.id } }), null, "an unreferenced dropped row is hard-deleted, not left around");
    });

    it("stock is written unconditionally when the caller sends no expectedStock (back-compat for callers that don't opt into the CAS)", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique, 5);

      const synced = await replaceVariants(
        product.id,
        [{ id: variant.id, size: "M", color: "Navy", sku: variant.sku, stock: 42, active: true }],
        adminId,
      );

      assert.equal(synced[0].stock, 42);
    });

    it("a stock edit succeeds via compare-and-set when expectedStock still matches the DB", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique, 5);

      const synced = await replaceVariants(
        product.id,
        [{ id: variant.id, size: "M", color: "Navy", sku: variant.sku, stock: 9, expectedStock: 5, active: true }],
        adminId,
      );

      assert.equal(synced[0].stock, 9);
    });

    it("a stock edit is rejected with VariantStockConflictError when the DB's stock has moved since expectedStock was read (F-023's P0 case)", async () => {
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique, 5);

      // Simulate a sale that happened after the admin's edit page loaded.
      await db.productVariant.update({ where: { id: variant.id }, data: { stock: 2 } });

      await assert.rejects(
        () =>
          replaceVariants(
            product.id,
            // The admin's form still thinks stock was 5 (its page-load
            // snapshot) and tries to write 10 over it.
            [{ id: variant.id, size: "M", color: "Navy", sku: variant.sku, stock: 10, expectedStock: 5, active: true }],
            adminId,
          ),
        VariantStockConflictError,
      );

      // The concurrent sale's stock value must survive, not be clobbered.
      const after = await db.productVariant.findUnique({ where: { id: variant.id } });
      assert.equal(after?.stock, 2);
    });

    it("an id that doesn't belong to this product is rejected with VariantOwnershipError", async () => {
      const unique = randomUUID().slice(0, 8);
      const { variant: otherVariant } = await makeProductWithVariant(`${unique}-other`);
      const { product } = await makeProductWithVariant(unique);

      await assert.rejects(
        () =>
          replaceVariants(
            product.id,
            [{ id: otherVariant.id, size: "S", color: "Red", sku: `DK-STEAL-${unique}`, stock: 1, active: true }],
            adminId,
          ),
        VariantOwnershipError,
      );
    });

    it("a concurrent sale between page-load and save keeps the decremented stock — the admin's unrelated field save never touches it", async () => {
      // This is F-023's headline repro: an admin editing (say) the short
      // description of a product must never silently undo a sale that
      // happened while the edit page was open. Here that means saving the
      // grid with the *unchanged* stock the form loaded (no expectedStock
      // opt-in, matching a plain field-only save where saveVariantsIfChanged
      // would actually skip the variants call entirely — see product-form.tsx)
      // must not fight with a concurrent decrement.
      const unique = randomUUID().slice(0, 8);
      const { product, variant } = await makeProductWithVariant(unique, 5);

      // A shopper's order decrements stock while the admin's edit page is open.
      await db.productVariant.update({ where: { id: variant.id }, data: { stock: 2 } });

      // The admin's grid still carries the id and every other field
      // unchanged, with expectedStock pinned to the page-load value (5) and
      // the same stock value (5) — i.e. the admin never touched stock, so
      // saveVariantsIfChanged's own per-row equality check would not even
      // include this field as "changed". replaceVariants must reach the
      // same result: stock stays at the concurrently-decremented value.
      const synced = await replaceVariants(
        product.id,
        [{ id: variant.id, size: "M", color: "Navy", sku: variant.sku, stock: 5, expectedStock: 5, active: true }],
        adminId,
      );

      assert.equal(synced[0].id, variant.id);
      const after = await db.productVariant.findUnique({ where: { id: variant.id } });
      assert.equal(after?.stock, 2, "the concurrent sale's stock must survive since the admin's own value equals expectedStock (no real edit)");
    });
  });

  describe("F-063: CATALOG_MANAGER cannot set status:ACTIVE directly, bypassing products:publish", () => {
    it("updateProduct rejects a DRAFT->ACTIVE transition when the caller lacks products:publish, even with an active variant", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `RBAC Direct Active ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-RBAC1-${unique}`, stock: 5, active: true }], adminId);

      await assert.rejects(
        () => updateProduct(product.id, { status: "ACTIVE" }, adminId, { canPublish: false }),
        ProductStatusPermissionError,
      );
      assert.equal((await db.product.findUnique({ where: { id: product.id } }))?.status, "DRAFT");
    });

    it("updateProduct rejects an ACTIVE->DRAFT unpublish when the caller lacks products:publish", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `RBAC Direct Unpublish ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-RBAC2-${unique}`, stock: 5, active: true }], adminId);
      await publishProduct(product.id, adminId);

      await assert.rejects(
        () => updateProduct(product.id, { status: "DRAFT" }, adminId, { canPublish: false }),
        ProductStatusPermissionError,
      );
      assert.equal((await db.product.findUnique({ where: { id: product.id } }))?.status, "ACTIVE");
    });

    it("updateProduct still allows ACTIVE->ARCHIVED without products:publish, matching the publish route's own archive rule", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `RBAC Archive OK ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-RBAC3-${unique}`, stock: 5, active: true }], adminId);
      await publishProduct(product.id, adminId);

      const archived = await updateProduct(product.id, { status: "ARCHIVED" }, adminId, { canPublish: false });
      assert.equal(archived.status, "ARCHIVED");
    });

    it("updateProduct allows a normal field edit with no status change even when canPublish is false", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `RBAC Ordinary Edit ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);

      const updated = await updateProduct(product.id, { shortDescription: "no status here" }, adminId, { canPublish: false });
      assert.equal(updated.shortDescription, "no status here");
      assert.equal(updated.status, "DRAFT");
    });

    it("updateProduct defaults canPublish to true for callers that don't pass the option (existing scripts/tests)", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `RBAC Default ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-RBAC4-${unique}`, stock: 5, active: true }], adminId);

      const updated = await updateProduct(product.id, { status: "ACTIVE" }, adminId);
      assert.equal(updated.status, "ACTIVE");
    });
  });

  // F-288: audit rows used to say "this product was updated" and nothing
  // else — a price dropped to ₹1 and a status flipped live left only
  // {name, slug}. Every update row now carries the before -> after.
  describe("F-288: audit rows record what actually changed", () => {
    /** The shape of the metadata these rows carry — only what the tests read. */
    type AuditMeta = {
      name?: string;
      changes: Record<string, { from: unknown; to: unknown }>;
      descriptionChanged?: boolean;
      fromStatus?: string;
      toStatus?: string;
      updated?: number;
      variantChanges?: unknown;
      variantsAdded: { sku: string }[];
      variantsRemoved?: unknown;
      bulkAction?: string;
      ids?: string[];
      statusChanges: Record<string, unknown>;
      percent?: number;
      priceChanges: Record<string, unknown>;
      stock?: number;
      previousStockTotals: Record<string, number>;
    };
    async function auditRows(entity: string, entityId: string) {
      const rows = await db.auditLog.findMany({ where: { entity, entityId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({ action: row.action, metadata: JSON.parse(row.metadata ?? "{}") as AuditMeta }));
    }

    it("updateProduct records the old and new price and status, and logs the PATCH as a publish", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Audit Price ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-AUD1-${unique}`, stock: 5, active: true }], adminId);

      await updateProduct(product.id, { price: 1, status: "ACTIVE" }, adminId);

      const rows = await auditRows("product", product.id);
      const update = rows.find((row) => row.action === "update");
      assert.ok(update, "an update row");
      assert.deepEqual(update.metadata.changes.price, { from: 500, to: 1 });
      assert.deepEqual(update.metadata.changes.status, { from: "DRAFT", to: "ACTIVE" });
      assert.equal(update.metadata.name, `Audit Price ${unique}`);

      const publish = rows.find((row) => row.action === "publish");
      assert.ok(publish, "a status change through PATCH must also be logged as a publish");
      assert.equal(publish.metadata.fromStatus, "DRAFT");
      assert.equal(publish.metadata.toStatus, "ACTIVE");
    });

    it("logs an unpublish / archive made through PATCH under its own action name", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Audit Status ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-AUD2-${unique}`, stock: 5, active: true }], adminId);
      await publishProduct(product.id, adminId);

      await updateProduct(product.id, { status: "DRAFT" }, adminId);
      await updateProduct(product.id, { status: "ARCHIVED" }, adminId);

      const actions = (await auditRows("product", product.id)).map((row) => row.action);
      assert.ok(actions.includes("unpublish"));
      assert.ok(actions.includes("archive"));
    });

    it("an ordinary save that re-sends unchanged fields records no changes and no phantom status event", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Audit Noop ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);

      await updateProduct(product.id, { name: product.name, price: 500, status: "DRAFT" }, adminId);

      const rows = await auditRows("product", product.id);
      const update = rows.find((row) => row.action === "update");
      assert.deepEqual(update?.metadata.changes, {});
      assert.ok(!rows.some((row) => ["publish", "unpublish", "archive", "unarchive"].includes(row.action)));
    });

    it("flags a description edit without copying the (long) HTML into the audit row", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Audit Desc ${unique}`, categoryId, price: 500, description: "<p>first</p>" }, adminId);
      createdProductIds.push(product.id);

      await updateProduct(product.id, { description: "<p>a brand new secret-marker description</p>" }, adminId);

      const rows = await db.auditLog.findMany({ where: { entity: "product", entityId: product.id, action: "update" } });
      assert.equal(rows.length, 1);
      assert.equal(JSON.parse(rows[0].metadata!).descriptionChanged, true);
      assert.ok(!rows[0].metadata!.includes("secret-marker"));
    });

    it("replaceVariants records each SKU's stock/price/active change, and the variants it added and removed", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Audit Variants ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);
      const synced = await replaceVariants(
        product.id,
        [
          { size: "S", color: "Navy", sku: `DK-AUDV-${unique}-S`, stock: 5, active: true },
          { size: "M", color: "Navy", sku: `DK-AUDV-${unique}-M`, stock: 9, active: true },
        ],
        adminId,
      );
      const small = synced.find((variant) => variant.size === "S")!;

      await replaceVariants(
        product.id,
        [
          { id: small.id, size: "S", color: "Navy", sku: small.sku, stock: 7, price: 450, active: false },
          { size: "L", color: "Navy", sku: `DK-AUDV-${unique}-L`, stock: 3, active: true },
        ],
        adminId,
      );

      const rows = await auditRows("product_variants", product.id);
      const last = rows[rows.length - 1];
      assert.equal(last.metadata.updated, 1);
      assert.deepEqual(last.metadata.variantChanges, [
        {
          sku: small.sku,
          changes: {
            price: { from: null, to: 450 },
            stock: { from: 5, to: 7 },
            active: { from: true, to: false },
          },
        },
      ]);
      assert.deepEqual(last.metadata.variantsAdded.map((v) => v.sku), [`DK-AUDV-${unique}-L`]);
      assert.deepEqual(last.metadata.variantsRemoved, [{ sku: `DK-AUDV-${unique}-M`, stock: 9, outcome: "deleted" }]);
    });

    it("performBulkAction records the percent with each product's old and new price, the stock value, and status changes", async () => {
      const unique = randomUUID().slice(0, 8);
      const a = await createProduct({ name: `Audit Bulk A ${unique}`, categoryId, price: 100 }, adminId);
      createdProductIds.push(a.id);
      await replaceVariants(a.id, [{ size: "S", color: "Navy", sku: `DK-AUDB-${unique}`, stock: 4, active: true }], adminId);

      const latestBulk = async () => {
        const rows = await db.auditLog.findMany({
          where: { entity: "product", action: "bulk-update" },
          orderBy: { createdAt: "desc" },
          take: 20,
        });
        return rows.map((row) => JSON.parse(row.metadata ?? "{}") as AuditMeta).filter((meta) => meta.ids?.includes(a.id));
      };

      await performBulkAction({ action: "publish", ids: [a.id] }, adminId);
      await performBulkAction({ action: "adjust-price-pct", ids: [a.id], percent: 10 }, adminId);
      await performBulkAction({ action: "set-stock", ids: [a.id], stock: 50 }, adminId);

      const byAction = new Map((await latestBulk()).map((meta) => [meta.bulkAction ?? "", meta]));
      assert.deepEqual(byAction.get("publish")?.statusChanges[a.id], { from: "DRAFT", to: "ACTIVE" });
      assert.equal(byAction.get("adjust-price-pct")?.percent, 10);
      assert.deepEqual(byAction.get("adjust-price-pct")?.priceChanges[a.id], { from: 100, to: 110 });
      assert.equal(byAction.get("set-stock")?.stock, 50);
      assert.equal(byAction.get("set-stock")?.previousStockTotals[a.id], 4);
    });
  });

  it("duplicateProduct copies variants and images with a new slug and DRAFT status", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Original ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);
    await replaceVariants(product.id, [{ size: "S", color: "Navy", sku: `DK-ORIG-${unique}`, stock: 5, active: true }], adminId);
    await publishProduct(product.id, adminId);

    const copy = await duplicateProduct(product.id, adminId);
    createdProductIds.push(copy.id);

    assert.notEqual(copy.slug, product.slug);
    assert.equal(copy.status, "DRAFT");

    const copyDetail = await getProductForAdmin(copy.id);
    assert.equal(copyDetail.variants.length, 1);
    assert.notEqual(copyDetail.variants[0].sku, `DK-ORIG-${unique}`);
  });

  it("listProductsForAdmin computes total stock and applies the stock filter", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Stock Test ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);
    await replaceVariants(
      product.id,
      [
        { size: "S", color: "Navy", sku: `DK-STOCK-${unique}-1`, stock: 3, active: true },
        { size: "M", color: "Navy", sku: `DK-STOCK-${unique}-2`, stock: 2, active: true },
      ],
      adminId,
    );

    const all = await listProductsForAdmin({ search: `Stock Test ${unique}` });
    assert.equal(all.items.length, 1);
    assert.equal(all.items[0].totalStock, 5);

    const low = await listProductsForAdmin({ search: `Stock Test ${unique}`, stockFilter: "low" });
    assert.equal(low.items.length, 1);

    const out = await listProductsForAdmin({ search: `Stock Test ${unique}`, stockFilter: "out" });
    assert.equal(out.items.length, 0);
  });

  // F-341 (release-hardening admin-table-mobile-and-pagination-perf):
  // listProductsForAdmin used to load every matching product into JS and
  // sort/paginate there — now the sort, the page slice and the count all
  // happen in the DB query itself (see products.ts's buildProductListWhereSql
  // / buildProductOrderBySql), with only the resulting page's rows ever
  // pulled back in full. These assert that refactor kept the same
  // observable sort/pagination/count behavior.
  it("listProductsForAdmin sorts and paginates at the DB level", async () => {
    const unique = randomUUID().slice(0, 8);
    // Created deliberately out of alphabetical order.
    const charlie = await createProduct({ name: `Page Sort ${unique} Charlie`, categoryId, price: 100 }, adminId);
    const alpha = await createProduct({ name: `Page Sort ${unique} Alpha`, categoryId, price: 100 }, adminId);
    const bravo = await createProduct({ name: `Page Sort ${unique} Bravo`, categoryId, price: 100 }, adminId);
    createdProductIds.push(charlie.id, alpha.id, bravo.id);

    const all = await listProductsForAdmin({ search: `Page Sort ${unique}`, sort: "name-asc", pageSize: 100 });
    assert.equal(all.total, 3);
    assert.deepEqual(
      all.items.map((p) => p.id),
      [alpha.id, bravo.id, charlie.id],
    );

    const pageOne = await listProductsForAdmin({ search: `Page Sort ${unique}`, sort: "name-asc", pageSize: 2, page: 1 });
    assert.equal(pageOne.total, 3, "total reflects every matching row, not just the page that was fetched");
    assert.equal(pageOne.totalPages, 2);
    assert.deepEqual(
      pageOne.items.map((p) => p.id),
      [alpha.id, bravo.id],
    );

    const pageTwo = await listProductsForAdmin({ search: `Page Sort ${unique}`, sort: "name-asc", pageSize: 2, page: 2 });
    assert.deepEqual(
      pageTwo.items.map((p) => p.id),
      [charlie.id],
    );
  });

  it("listProductsForAdmin's stock-asc sort orders by each product's total variant stock, not just an in-page JS sort", async () => {
    const unique = randomUUID().slice(0, 8);
    const high = await createProduct({ name: `Stock Sort ${unique} High`, categoryId, price: 100 }, adminId);
    const low = await createProduct({ name: `Stock Sort ${unique} Low`, categoryId, price: 100 }, adminId);
    createdProductIds.push(high.id, low.id);
    // Created in an order (high, then low) that would defeat a sort
    // computed only within one already-fetched page in the old total-order.
    await replaceVariants(high.id, [{ size: "S", color: "Navy", sku: `DK-SORT-${unique}-HIGH`, stock: 50, active: true }], adminId);
    await replaceVariants(low.id, [{ size: "S", color: "Navy", sku: `DK-SORT-${unique}-LOW`, stock: 1, active: true }], adminId);

    const sorted = await listProductsForAdmin({ search: `Stock Sort ${unique}`, sort: "stock-asc" });
    assert.deepEqual(
      sorted.items.map((p) => p.id),
      [low.id, high.id],
    );
  });

  // F-262: the total and the requested page are fetched together, and a
  // page past the end is re-queried clamped to the last page.
  it("listProductsForAdmin clamps a page past the end to the last page, with its rows", async () => {
    const unique = randomUUID().slice(0, 8);
    const first = await createProduct({ name: `Clamp ${unique} A`, categoryId, price: 100 }, adminId);
    const second = await createProduct({ name: `Clamp ${unique} B`, categoryId, price: 100 }, adminId);
    const third = await createProduct({ name: `Clamp ${unique} C`, categoryId, price: 100 }, adminId);
    createdProductIds.push(first.id, second.id, third.id);

    const beyond = await listProductsForAdmin({ search: `Clamp ${unique}`, sort: "name-asc", pageSize: 2, page: 99 });
    assert.equal(beyond.page, 2);
    assert.equal(beyond.totalPages, 2);
    assert.deepEqual(
      beyond.items.map((p) => p.id),
      [third.id],
    );

    const none = await listProductsForAdmin({ search: `Clamp ${unique} no-such-product`, page: 5 });
    assert.equal(none.total, 0);
    assert.equal(none.page, 1);
    assert.deepEqual(none.items, []);
  });

  // F-262: hasAiImage now comes from a filtered relation count in the same
  // query as the rows — it must still flag *any* AI-sourced image, not just
  // the first (thumbnail) one.
  it("listProductsForAdmin flags hasAiImage when any image of the product is AI-sourced", async () => {
    const unique = randomUUID().slice(0, 8);
    const withAi = await createProduct({ name: `Ai Badge ${unique} With`, categoryId, price: 100 }, adminId);
    const withoutAi = await createProduct({ name: `Ai Badge ${unique} Without`, categoryId, price: 100 }, adminId);
    createdProductIds.push(withAi.id, withoutAi.id);
    const mediaKey = (label: string) => `test/ai-badge-${label}-${unique}.webp`;
    const makeMedia = (label: string, source: "UPLOAD" | "AI") =>
      db.mediaAsset.create({
        data: { key: mediaKey(label), url: `/cdn/${mediaKey(label)}`, usage: "PRODUCT", source },
      });
    const upload = await makeMedia("upload", "UPLOAD");
    const ai = await makeMedia("ai", "AI");
    const plain = await makeMedia("plain", "UPLOAD");
    try {
      // The AI image is the second one, so the thumbnail (sortOrder 0) is an upload.
      await db.productImage.create({ data: { productId: withAi.id, mediaId: upload.id, sortOrder: 0 } });
      await db.productImage.create({ data: { productId: withAi.id, mediaId: ai.id, sortOrder: 1 } });
      await db.productImage.create({ data: { productId: withoutAi.id, mediaId: plain.id, sortOrder: 0 } });

      const result = await listProductsForAdmin({ search: `Ai Badge ${unique}`, sort: "name-asc" });
      const byId = new Map(result.items.map((item) => [item.id, item]));
      assert.equal(byId.get(withAi.id)?.hasAiImage, true);
      assert.equal(byId.get(withAi.id)?.thumbnailUrl, `/cdn/${mediaKey("upload")}`);
      assert.equal(byId.get(withoutAi.id)?.hasAiImage, false);
    } finally {
      await db.productImage.deleteMany({ where: { productId: { in: [withAi.id, withoutAi.id] } } });
      await db.mediaAsset.deleteMany({ where: { id: { in: [upload.id, ai.id, plain.id] } } });
    }
  });

  // F-192
  it("listProductsForAdmin's search also matches a variant SKU, case-insensitively", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Sku Search ${unique}`, categoryId, price: 500 }, adminId);
    createdProductIds.push(product.id);
    const sku = `DK-SKUSEARCH-${unique}-M-NAVY`;
    await replaceVariants(product.id, [{ size: "M", color: "Navy", sku, stock: 5, active: true }], adminId);

    const bySku = await listProductsForAdmin({ search: sku });
    assert.equal(bySku.items.length, 1);
    assert.equal(bySku.items[0].id, product.id);

    const lowercase = await listProductsForAdmin({ search: sku.toLowerCase() });
    assert.equal(lowercase.items.length, 1);
    assert.equal(lowercase.items[0].id, product.id);

    const noMatch = await listProductsForAdmin({ search: `does-not-exist-${unique}` });
    assert.equal(noMatch.items.length, 0);
  });

  describe("F-177: the admin category filter matches on categoryId (with descendants), not categorySlug", () => {
    it("filtering by a category's own id returns its products", async () => {
      const unique = randomUUID().slice(0, 8);
      const product = await createProduct({ name: `Cat Filter Leaf ${unique}`, categoryId, price: 500 }, adminId);
      createdProductIds.push(product.id);

      // This is the bug's exact repro shape: the admin table's <option>
      // value is the category id, sent as `categoryId` — `categorySlug`
      // (a real slug) must keep working for any other caller too.
      const byId = await listProductsForAdmin({ categoryId, search: `Cat Filter Leaf ${unique}` });
      assert.equal(byId.items.length, 1);

      const bySlug = await listProductsForAdmin({ categorySlug, search: `Cat Filter Leaf ${unique}` });
      assert.equal(bySlug.items.length, 1);
    });

    it("filtering by a parent category id also returns its children's products", async () => {
      const unique = randomUUID().slice(0, 8);
      const parent = await db.category.create({
        data: { name: `Cat Filter Parent ${unique}`, slug: `cat-filter-parent-${unique}`, section: "GENERAL" },
      });
      const child = await db.category.create({
        data: { name: `Cat Filter Child ${unique}`, slug: `cat-filter-child-${unique}`, section: "GENERAL", parentId: parent.id },
      });
      createdCategoryIds.push(parent.id, child.id);

      // Mirrors the real catalogue's shape (e.g. "School Uniforms"): the
      // parent itself holds no products directly — only its child does.
      const product = await createProduct({ name: `Cat Filter Grandchild ${unique}`, categoryId: child.id, price: 500 }, adminId);
      createdProductIds.push(product.id);

      const byParent = await listProductsForAdmin({ categoryId: parent.id, search: `Cat Filter Grandchild ${unique}` });
      assert.equal(byParent.items.length, 1, "a parent category filter must include its descendants' products");

      const byChild = await listProductsForAdmin({ categoryId: child.id, search: `Cat Filter Grandchild ${unique}` });
      assert.equal(byChild.items.length, 1);
    });
  });

  it("performBulkAction publishes, archives, adjusts price, and sets stock across products", async () => {
    const unique = randomUUID().slice(0, 8);
    const a = await createProduct({ name: `Bulk A ${unique}`, categoryId, price: 100 }, adminId);
    const b = await createProduct({ name: `Bulk B ${unique}`, categoryId, price: 200 }, adminId);
    createdProductIds.push(a.id, b.id);
    await replaceVariants(a.id, [{ size: "S", color: "Navy", sku: `DK-BULK-${unique}-A`, stock: 1, active: true }], adminId);
    await replaceVariants(b.id, [{ size: "S", color: "Navy", sku: `DK-BULK-${unique}-B`, stock: 1, active: true }], adminId);

    const publishResult = await performBulkAction({ action: "publish", ids: [a.id, b.id] }, adminId);
    assert.equal(publishResult.affected, 2);
    assert.equal((await db.product.findUnique({ where: { id: a.id } }))?.status, "ACTIVE");

    await performBulkAction({ action: "adjust-price-pct", ids: [a.id], percent: 10 }, adminId);
    const adjusted = await db.product.findUnique({ where: { id: a.id } });
    assert.equal(Number(adjusted?.price), 110);

    await performBulkAction({ action: "set-stock", ids: [a.id, b.id], stock: 50 }, adminId);
    const variantA = await db.productVariant.findFirst({ where: { productId: a.id } });
    assert.equal(variantA?.stock, 50);

    await performBulkAction({ action: "archive", ids: [a.id, b.id] }, adminId);
    assert.equal((await db.product.findUnique({ where: { id: b.id } }))?.status, "ARCHIVED");
  });

  it("performBulkAction's adjust-price-pct skips a product that would push price past its compareAtPrice, applies the rest, and reports the skip (F6)", async () => {
    const unique = randomUUID().slice(0, 8);
    // No compareAtPrice at all — nothing to violate, a big bump applies cleanly.
    const unguarded = await createProduct({ name: `Bulk PctUnguarded ${unique}`, categoryId, price: 100 }, adminId);
    // compareAtPrice close enough to price that a +50% bump would land at
    // or above it — createProduct/updateProduct would reject this shape
    // via InvalidCompareAtPriceError; the bulk path must enforce the same
    // invariant instead of writing a corrupt price straight to the DB.
    const guarded = await createProduct(
      { name: `Bulk PctGuarded ${unique}`, categoryId, price: 100, compareAtPrice: 120 },
      adminId,
    );
    createdProductIds.push(unguarded.id, guarded.id);

    const result = await performBulkAction({ action: "adjust-price-pct", ids: [unguarded.id, guarded.id], percent: 50 }, adminId);

    assert.equal(result.affected, 1, "only the unguarded product should count as affected");
    assert.equal(result.skipped?.length, 1);
    assert.equal(result.skipped?.[0].id, guarded.id);
    assert.equal(result.skipped?.[0].name, guarded.name);
    assert.match(result.skipped?.[0].reason ?? "", /compare-at price/i);

    const unguardedAfter = await db.product.findUnique({ where: { id: unguarded.id } });
    assert.equal(Number(unguardedAfter?.price), 150);

    // The skipped row must be left completely untouched — not clamped,
    // not partially applied.
    const guardedAfter = await db.product.findUnique({ where: { id: guarded.id } });
    assert.equal(Number(guardedAfter?.price), 100);
    assert.equal(Number(guardedAfter?.compareAtPrice), 120);
  });

  // F-182
  it("performBulkAction's adjust-price-pct rounds to whole rupees, not paise", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Bulk Rupee ${unique}`, categoryId, price: 899 }, adminId);
    createdProductIds.push(product.id);

    await performBulkAction({ action: "adjust-price-pct", ids: [product.id], percent: 10 }, adminId);

    const updated = await db.product.findUnique({ where: { id: product.id } });
    // 899 * 1.10 = 988.9 -> rounds to the nearest whole rupee (989), never
    // stored as 988.90.
    assert.equal(Number(updated?.price), 989);
  });

  it("performBulkAction's adjust-price-pct also adjusts variant price overrides, and leaves non-overridden variants alone", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Bulk Override ${unique}`, categoryId, price: 899 }, adminId);
    createdProductIds.push(product.id);
    await replaceVariants(
      product.id,
      [
        { size: "M", color: "Navy", sku: `DK-OVR-${unique}-M`, stock: 5, active: true, price: 950 },
        { size: "L", color: "Navy", sku: `DK-OVR-${unique}-L`, stock: 5, active: true },
      ],
      adminId,
    );

    await performBulkAction({ action: "adjust-price-pct", ids: [product.id], percent: 10 }, adminId);

    const overridden = await db.productVariant.findFirst({ where: { productId: product.id, size: "M" } });
    const plain = await db.productVariant.findFirst({ where: { productId: product.id, size: "L" } });
    assert.equal(Number(overridden?.price), 1045); // 950 * 1.10 = 1045
    assert.equal(plain?.price, null); // no override to begin with — stays null, inherits the new base price
  });

  it("performBulkAction's adjust-price-pct skips the whole product (base price included) when only a variant override would violate the compare-at invariant", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct(
      { name: `Bulk Override Guard ${unique}`, categoryId, price: 100, compareAtPrice: 1100 },
      adminId,
    );
    createdProductIds.push(product.id);
    // The base price (100 -> 110 at +10%) is nowhere near compareAtPrice
    // (1100), but the override (1000 -> 1100) would land right at it.
    await replaceVariants(
      product.id,
      [{ size: "M", color: "Navy", sku: `DK-OVRGUARD-${unique}`, stock: 5, active: true, price: 1000 }],
      adminId,
    );

    const result = await performBulkAction({ action: "adjust-price-pct", ids: [product.id], percent: 10 }, adminId);

    assert.equal(result.affected, 0);
    assert.equal(result.skipped?.length, 1);
    assert.equal(result.skipped?.[0].id, product.id);

    const productAfter = await db.product.findUnique({ where: { id: product.id } });
    const variantAfter = await db.productVariant.findFirst({ where: { productId: product.id } });
    assert.equal(Number(productAfter?.price), 100, "base price must be left untouched too, not just the override");
    assert.equal(Number(variantAfter?.price), 1000);
  });

  // F-340
  it("performBulkAction's adjust-price-pct compounds correctly under two overlapping runs on the same product, instead of one clobbering the other", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Bulk Concurrent ${unique}`, categoryId, price: 1000 }, adminId);
    createdProductIds.push(product.id);

    await Promise.all([
      performBulkAction({ action: "adjust-price-pct", ids: [product.id], percent: 10 }, adminId),
      performBulkAction({ action: "adjust-price-pct", ids: [product.id], percent: 10 }, adminId),
    ]);

    const after = await db.product.findUnique({ where: { id: product.id } });
    // Both +10% runs must compound (1000 -> 1100 -> 1210) under the
    // database's own row-level locking — a JS read-then-write race used to
    // let the second run's write clobber the first's, leaving 1100.
    assert.equal(Number(after?.price), 1210);
  });

  it("import dry-run then commit creates products and variants, and re-running commit updates instead of duplicating", async () => {
    const unique = randomUUID().slice(0, 8);
    const slug = `import-test-${unique}`;
    const header = [...IMPORT_COLUMNS];
    const buildRow = (sku: string, stock: string) => [
      slug,
      `Import Test ${unique}`,
      categorySlug,
      "",
      "",
      "699",
      "",
      "",
      "",
      "UNISEX",
      "",
      "",
      "",
      "M",
      "Navy",
      "#1E3A5F",
      sku,
      stock,
      "yes",
      "no",
    ];
    const csv = stringifyCsv([header, buildRow(`DK-IMPORT-${unique}`, "15")]);

    const dryRun = await dryRunProductImport(csv);
    assert.equal(dryRun.summary.error, 0);
    assert.equal(dryRun.summary.products, 1);

    const commit1 = await commitProductImport(csv, adminId, { generateImages: false });
    const created = await db.product.findUnique({ where: { slug } });
    assert.ok(created);
    createdProductIds.push(created!.id);
    assert.equal(commit1.productsCreated, 1);
    assert.equal(commit1.variantsWritten, 1);

    // Re-run with an updated stock value for the same slug/sku — should update, not duplicate.
    const csv2 = stringifyCsv([header, buildRow(`DK-IMPORT-${unique}`, "42")]);
    const commit2 = await commitProductImport(csv2, adminId, { generateImages: false });
    assert.equal(commit2.productsCreated, 0);
    assert.equal(commit2.productsUpdated, 1);

    const allProducts = await db.product.findMany({ where: { slug } });
    assert.equal(allProducts.length, 1);
    const updatedVariant = await db.productVariant.findUnique({ where: { sku: `DK-IMPORT-${unique}` } });
    assert.equal(updatedVariant?.stock, 42);
  });

  it("export round-trip: exporting then re-importing the same product doesn't change counts", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createProduct({ name: `Export Test ${unique}`, categoryId, price: 799 }, adminId);
    createdProductIds.push(product.id);
    await replaceVariants(product.id, [{ size: "L", color: "Wine", sku: `DK-EXPORT-${unique}`, stock: 7, active: true }], adminId);

    const csv = await exportProductsCsv({ categorySlug });
    const rows = parseCsv(csv);
    const matching = rows.find((r) => r[0] === product.slug);
    assert.ok(matching, "expected the export to include the product row");

    const recommit = await commitProductImport(csv, adminId, { generateImages: false });
    // Every product in the category already exists — commit should update
    // all of them, creating none.
    assert.equal(recommit.productsCreated, 0);
    assert.ok(recommit.productsUpdated >= 1);
  });

  it("buildSkuOwnership excludes a variant whose owning product can't be resolved, instead of crashing (Bug 3 regression)", () => {
    // Deterministic reproduction of the "export round-trip" flake: with
    // the pg driver adapter, product-import.ts's fetchValidationContext
    // resolves each ProductVariant's owning product via a *second*,
    // separate `SELECT ... WHERE id IN (...)` query rather than a single
    // atomic SQL join. A product deleted between those two queries left a
    // variant whose `productId` doesn't resolve — previously that crashed
    // with a null-deref (`v.product.slug`) roughly 1 run in 3 under the
    // integration suite's concurrent test files. This exercises the exact
    // same shape directly, with no DB and no timing dependency, so the
    // regression can't flake either way.
    const productSlugById = new Map([["prod-1", "product-one"]]);
    const variants = [
      { sku: "dk-a", productId: "prod-1" },
      { sku: "dk-b", productId: "prod-deleted-mid-query" },
    ];

    const { existingSkus, skuOwner } = buildSkuOwnership(variants, productSlugById);

    assert.deepEqual([...existingSkus].sort(), ["DK-A", "DK-B"]);
    assert.equal(skuOwner.get("DK-A"), "product-one");
    assert.equal(skuOwner.has("DK-B"), false, "a variant whose product can't be resolved must be excluded, never dereferenced");
    assert.equal(skuOwner.size, 1);
  });
});

describe("products admin routes without a session", () => {
  const idParams = Promise.resolve({ id: "any-id" });

  it("GET /api/admin/products rejects with 401/403", async () => {
    const response = await getProducts(new Request("http://localhost/api/admin/products"));
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/products rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", categoryId: "y", price: 1 }),
    });
    const response = await postProduct(request);
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/products/[id] rejects with 401/403", async () => {
    const response = await getProductRoute(new Request("http://localhost/api/admin/products/any-id"), { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("PATCH /api/admin/products/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/products/any-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const response = await patchProductRoute(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("DELETE /api/admin/products/[id] rejects with 401/403", async () => {
    const response = await deleteProductRoute(new Request("http://localhost/api/admin/products/any-id", { method: "DELETE" }), { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/products/[id]/publish rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/products/any-id/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    const response = await publishRoute(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/products/[id]/variants rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/products/any-id/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variants: [] }),
    });
    const response = await variantsRoute(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/products/bulk rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", ids: ["x"] }),
    });
    const response = await bulkRoute(request);
    assert.ok(response.status === 401 || response.status === 403);
  });
});

// F-194: the image PATCH/DELETE helpers used to look the image up by imageId
// alone, so /products/{A}/images/{imageOfB} silently edited or removed
// product B's image (and revalidated B) while the URL claimed to act on A.
describe("product image helpers are scoped to the product in the URL (F-194)", () => {
  it("refuses to change or remove another product's image, and leaves it untouched", async () => {
    const suffix = randomUUID();
    const adminId = await findAnyAdminId();
    const category = await db.category.create({
      data: { name: `Image Scope ${suffix}`, slug: `image-owner-scope-${suffix}`, section: "GENERAL" },
    });
    const productA = await db.product.create({
      data: { name: "Image Owner A", slug: `image-owner-a-${suffix}`, categoryId: category.id, price: 499 },
    });
    const productB = await db.product.create({
      data: { name: "Image Owner B", slug: `image-owner-b-${suffix}`, categoryId: category.id, price: 499 },
    });
    const mediaA = await db.mediaAsset.create({
      data: { key: `test/image-owner-a-${suffix}.webp`, url: `/cdn/test/image-owner-a-${suffix}.webp`, usage: "PRODUCT" },
    });
    const mediaB = await db.mediaAsset.create({
      data: { key: `test/image-owner-b-${suffix}.webp`, url: `/cdn/test/image-owner-b-${suffix}.webp`, usage: "PRODUCT" },
    });
    try {
      const imageA = await db.productImage.create({ data: { productId: productA.id, mediaId: mediaA.id, color: "Navy", alt: "A" } });
      const imageB = await db.productImage.create({ data: { productId: productB.id, mediaId: mediaB.id, color: "Navy", alt: "B" } });

      // Every helper, called with product A's id and product B's image id.
      await assert.rejects(() => setImageColor(productA.id, imageB.id, "Red", adminId), ProductImageNotFoundError);
      await assert.rejects(() => updateImageAlt(productA.id, imageB.id, "hijacked", adminId), ProductImageNotFoundError);
      await assert.rejects(() => removeProductImage(productA.id, imageB.id, adminId), ProductImageNotFoundError);
      await assert.rejects(() => reorderProductImages(productA.id, imageB.id, "up", adminId), ProductImageNotFoundError);

      const untouched = await db.productImage.findUniqueOrThrow({ where: { id: imageB.id } });
      assert.equal(untouched.color, "Navy");
      assert.equal(untouched.alt, "B");

      // The matching product/image pair still works.
      const recoloured = await setImageColor(productA.id, imageA.id, "Red", adminId);
      assert.equal(recoloured.color, "Red");
      const renamed = await updateImageAlt(productA.id, imageA.id, "A renamed", adminId);
      assert.equal(renamed.alt, "A renamed");

      // F-288: the audit rows say which product the photo belongs to and
      // what changed (they used to be a bare {alt} / {color}).
      const imageRows = await db.auditLog.findMany({
        where: { entity: "product_image", entityId: imageA.id, action: "update" },
        orderBy: { createdAt: "asc" },
      });
      const [colorRow, altRow] = imageRows.map((row) => JSON.parse(row.metadata!) as { productId: string; changes: Record<string, unknown> });
      assert.equal(colorRow.productId, productA.id);
      assert.deepEqual(colorRow.changes, { color: { from: "Navy", to: "Red" } });
      assert.equal(altRow.productId, productA.id);
      assert.deepEqual(altRow.changes, { alt: { from: "A", to: "A renamed" } });

      await removeProductImage(productA.id, imageA.id, adminId);
      assert.equal(await db.productImage.findUnique({ where: { id: imageA.id } }), null);
    } finally {
      await db.product.deleteMany({ where: { id: { in: [productA.id, productB.id] } } });
      await db.mediaAsset.deleteMany({ where: { id: { in: [mediaA.id, mediaB.id] } } });
      await db.category.delete({ where: { id: category.id } });
    }
  });
});

// F-362: a photo removed from its only product (or left behind by a deleted
// product) used to stay in R2 and the media library forever — still publicly
// downloadable through /cdn. It is now reclaimed, unless something else
// (another product, a category, a review, a hero slide) still uses it.
describe("removed and deleted product photos are reclaimed (F-362)", () => {
  async function setup() {
    const suffix = randomUUID();
    const adminId = await findAnyAdminId();
    const category = await db.category.create({
      data: { name: `Reclaim ${suffix}`, slug: `reclaim-${suffix}`, section: "GENERAL" },
    });
    async function product(label: string) {
      return db.product.create({
        data: { name: `Reclaim ${label}`, slug: `reclaim-${label}-${suffix}`, categoryId: category.id, price: 499 },
      });
    }
    async function media(label: string) {
      return db.mediaAsset.create({
        data: { key: `test/reclaim-${label}-${suffix}.webp`, url: `/cdn/test/reclaim-${label}-${suffix}.webp`, usage: "PRODUCT" },
      });
    }
    return { suffix, adminId, category, product, media };
  }

  it("removing a product's only use of a photo deletes the asset; a photo still attached to another product survives", async () => {
    const { adminId, category, product, media } = await setup();
    const productA = await product("a");
    const productB = await product("b");
    const sole = await media("sole");
    const shared = await media("shared");
    try {
      const soleImage = await db.productImage.create({ data: { productId: productA.id, mediaId: sole.id } });
      const sharedOnA = await db.productImage.create({ data: { productId: productA.id, mediaId: shared.id } });
      await db.productImage.create({ data: { productId: productB.id, mediaId: shared.id } });

      await removeProductImage(productA.id, soleImage.id, adminId);
      assert.equal(await db.productImage.findUnique({ where: { id: soleImage.id } }), null);
      assert.equal(await db.mediaAsset.findUnique({ where: { id: sole.id } }), null, "an unreferenced photo must be reclaimed");

      await removeProductImage(productA.id, sharedOnA.id, adminId);
      assert.equal(await db.productImage.findUnique({ where: { id: sharedOnA.id } }), null);
      assert.ok(await db.mediaAsset.findUnique({ where: { id: shared.id } }), "a photo another product still uses must survive");
    } finally {
      await db.product.deleteMany({ where: { id: { in: [productA.id, productB.id] } } });
      await db.mediaAsset.deleteMany({ where: { id: { in: [sole.id, shared.id] } } });
      await db.category.delete({ where: { id: category.id } });
    }
  });

  it("deleting a draft product reclaims its gallery photos, except ones another product still uses", async () => {
    const { adminId, category, product, media } = await setup();
    const doomed = await product("doomed");
    const other = await product("other");
    const only = await media("only");
    const shared = await media("shared");
    try {
      await db.productImage.create({ data: { productId: doomed.id, mediaId: only.id } });
      await db.productImage.create({ data: { productId: doomed.id, mediaId: shared.id } });
      await db.productImage.create({ data: { productId: other.id, mediaId: shared.id } });

      await deleteProduct(doomed.id, adminId);
      assert.equal(await db.product.findUnique({ where: { id: doomed.id } }), null);
      assert.equal(await db.mediaAsset.findUnique({ where: { id: only.id } }), null, "the deleted product's own photo must be reclaimed");
      assert.ok(await db.mediaAsset.findUnique({ where: { id: shared.id } }), "a photo another product still uses must survive");
      assert.equal(await db.productImage.count({ where: { productId: other.id } }), 1);
    } finally {
      await db.product.deleteMany({ where: { id: { in: [doomed.id, other.id] } } });
      await db.mediaAsset.deleteMany({ where: { id: { in: [only.id, shared.id] } } });
      await db.category.delete({ where: { id: category.id } });
    }
  });
});
