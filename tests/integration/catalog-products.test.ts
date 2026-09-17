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
  ProductNotDraftError,
  ProductNotFoundError,
  ProductSlugConflictError,
  publishProduct,
  replaceVariants,
  unpublishProduct,
  updateProduct,
} from "@/lib/catalog/products";
import { DuplicateVariantKeyError } from "@/lib/catalog/product-validation";
import { commitProductImport, dryRunProductImport, exportProductsCsv } from "@/lib/catalog/product-import";
import { IMPORT_COLUMNS, parseCsv, stringifyCsv } from "@/lib/catalog/csv";
import { GET as getProducts, POST as postProduct } from "@/app/api/admin/products/route";
import { DELETE as deleteProductRoute, GET as getProductRoute, PATCH as patchProductRoute } from "@/app/api/admin/products/[id]/route";
import { POST as bulkRoute } from "@/app/api/admin/products/bulk/route";
import { POST as publishRoute } from "@/app/api/admin/products/[id]/publish/route";
import { POST as variantsRoute } from "@/app/api/admin/products/[id]/variants/route";

/**
 * Phase B1: product admin CRUD, exercised at the library layer
 * (src/lib/catalog/products.ts and product-import.ts) — same rationale as
 * tests/integration/catalog-admin.test.ts: requireAdminPermission's
 * getSession() needs a real Next.js request context, so the business
 * rules are tested directly, plus a 401/403 sweep of the route handlers.
 */

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

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

    const published = await publishProduct(product.id, adminId);
    assert.equal(published.status, "ACTIVE");

    const unpublished = await unpublishProduct(product.id, adminId);
    assert.equal(unpublished.status, "DRAFT");
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
    await publishProduct(product.id, adminId);

    await assert.rejects(() => deleteProduct(product.id, adminId), ProductNotDraftError);
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
