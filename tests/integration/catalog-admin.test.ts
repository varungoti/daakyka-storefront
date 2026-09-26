import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  createCategory,
  CategoryCycleError,
  CategoryDeleteBlockedError,
  CategoryNotFoundError,
  CategoryParentNotFoundError,
  CategorySectionMismatchError,
  CategorySlugConflictError,
  deleteCategory,
  reorderCategory,
  SizeChartRefNotFoundError,
  updateCategory,
} from "@/lib/catalog/categories";
import {
  createSizeChart,
  deleteSizeChart,
  SizeChartInUseError,
  SizeChartNotFoundError,
  updateSizeChart,
} from "@/lib/catalog/size-charts";
import { GET as getCategories, POST as postCategory } from "@/app/api/admin/categories/route";
import {
  DELETE as deleteCategoryRoute,
  GET as getCategory,
  PATCH as patchCategory,
} from "@/app/api/admin/categories/[id]/route";
import { POST as reorderCategoryRoute } from "@/app/api/admin/categories/[id]/reorder/route";
import { GET as getSizeCharts, POST as postSizeChart } from "@/app/api/admin/size-charts/route";
import {
  DELETE as deleteSizeChartRoute,
  GET as getSizeChart,
  PATCH as patchSizeChart,
} from "@/app/api/admin/size-charts/[id]/route";
import { GET as exportProducts } from "@/app/api/admin/products/export/route";
import { findAnyAdminId } from "../helpers/admin-user";

/**
 * Phase B2: categories + size-chart admin CRUD, exercised at the library
 * layer (src/lib/catalog/*), plus a 401/403 check on every route handler.
 *
 * Route handlers can't be called with a real authenticated session outside
 * an actual Next.js request (requireAdminPermission's getSession() needs
 * next/headers' cookies() — see tests/integration/site-settings.test.ts and
 * tests/integration/media.test.ts for the same constraint), so the create/
 * update/delete *business rules* are tested directly against the service
 * functions the routes call, and every test category/size-chart created
 * here is cleaned up in `after()` hooks.
 */

const createdCategoryIds: string[] = [];
const createdSizeChartIds: string[] = [];
const createdProductIds: string[] = [];

after(async () => {
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  // Children before parents (categoryId FK is Restrict, and parentId is
  // SetNull, so this order isn't strictly required for parentId, but it
  // keeps intent obvious).
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
  if (createdSizeChartIds.length > 0) {
    await db.sizeChart.deleteMany({ where: { id: { in: createdSizeChartIds } } }).catch(() => {});
  }
});

describe("categories admin service (Phase B2)", () => {
  let adminId: string;

  before(async () => {
    adminId = await findAnyAdminId();
  });

  it("createCategory generates a unique slug from the name and persists the row", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await createCategory(
      { name: `Test Category ${unique}`, section: "GENERAL" },
      adminId,
    );
    createdCategoryIds.push(category.id);

    assert.equal(category.slug, `test-category-${unique}`);
    assert.equal(category.section, "GENERAL");
    assert.equal(category.active, true);
    assert.equal(category.showInMenu, true);

    const row = await db.category.findUnique({ where: { id: category.id } });
    assert.ok(row);
  });

  it("createCategory rejects a slug already used by another category", async () => {
    const unique = randomUUID().slice(0, 8);
    const first = await createCategory({ name: `Dup ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(first.id);

    await assert.rejects(
      () => createCategory({ name: `Different Name`, slug: first.slug, section: "GENERAL" }, adminId),
      CategorySlugConflictError,
    );
  });

  it("createCategory rejects a parent that doesn't exist", async () => {
    await assert.rejects(
      () => createCategory({ name: `No Parent ${randomUUID().slice(0, 8)}`, section: "GENERAL", parentId: "nope" }, adminId),
      CategoryParentNotFoundError,
    );
  });

  it("createCategory rejects a parent in a different section", async () => {
    const unique = randomUUID().slice(0, 8);
    const hospitalParent = await createCategory({ name: `Hosp Parent ${unique}`, section: "HOSPITAL" }, adminId);
    createdCategoryIds.push(hospitalParent.id);

    await assert.rejects(
      () =>
        createCategory(
          { name: `School Child ${unique}`, section: "SCHOOL", parentId: hospitalParent.id },
          adminId,
        ),
      CategorySectionMismatchError,
    );
  });

  it("createCategory rejects a sizeChartId that doesn't exist", async () => {
    await assert.rejects(
      () =>
        createCategory(
          { name: `Bad Chart ${randomUUID().slice(0, 8)}`, section: "GENERAL", sizeChartId: "nope" },
          adminId,
        ),
      SizeChartRefNotFoundError,
    );
  });

  // F-193
  it("createCategory appends a new sub-category after its siblings instead of defaulting sortOrder to 0", async () => {
    const unique = randomUUID().slice(0, 8);
    const parent = await createCategory({ name: `Sort Parent ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(parent.id);

    const first = await createCategory({ name: `Sort Child A ${unique}`, section: "GENERAL", parentId: parent.id }, adminId);
    createdCategoryIds.push(first.id);
    assert.equal(first.sortOrder, 10);

    const second = await createCategory({ name: `Sort Child B ${unique}`, section: "GENERAL", parentId: parent.id }, adminId);
    createdCategoryIds.push(second.id);
    assert.equal(second.sortOrder, 20);
  });

  it("createCategory still honors an explicit sortOrder", async () => {
    const category = await createCategory(
      { name: `Explicit Sort ${randomUUID().slice(0, 8)}`, section: "GENERAL", sortOrder: 5 },
      adminId,
    );
    createdCategoryIds.push(category.id);
    assert.equal(category.sortOrder, 5);
  });

  it("reorderCategory moves a category even when it and its sibling already share the same sortOrder (F-193 tie bug)", async () => {
    const unique = randomUUID().slice(0, 8);
    const parent = await createCategory({ name: `Reorder Tie Parent ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(parent.id);

    // Simulates two categories created before the nextSiblingSortOrder fix
    // (both defaulting to the same value) by setting it explicitly.
    const a = await createCategory({ name: `Reorder Tie A ${unique}`, section: "GENERAL", parentId: parent.id, sortOrder: 0 }, adminId);
    createdCategoryIds.push(a.id);
    const b = await createCategory({ name: `Reorder Tie B ${unique}`, section: "GENERAL", parentId: parent.id, sortOrder: 0 }, adminId);
    createdCategoryIds.push(b.id);

    const initial = await db.category.findMany({ where: { parentId: parent.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    assert.equal(initial.length, 2);
    const [firstId, secondId] = [initial[0].id, initial[1].id];

    const moved = await reorderCategory(secondId, "up", adminId);
    assert.equal(moved, true);

    const after = await db.category.findMany({ where: { parentId: parent.id }, orderBy: { sortOrder: "asc" } });
    assert.equal(after.length, 2);
    assert.equal(after[0].id, secondId);
    assert.equal(after[1].id, firstId);
    assert.notEqual(after[0].sortOrder, after[1].sortOrder);
  });

  it("reorderCategory returns false (no-op) at either end of the sibling list", async () => {
    const unique = randomUUID().slice(0, 8);
    const parent = await createCategory({ name: `Reorder Bound Parent ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(parent.id);
    const only = await createCategory({ name: `Only Child ${unique}`, section: "GENERAL", parentId: parent.id }, adminId);
    createdCategoryIds.push(only.id);

    assert.equal(await reorderCategory(only.id, "up", adminId), false);
    assert.equal(await reorderCategory(only.id, "down", adminId), false);
  });

  it("updateCategory prevents a cycle when moving a category under its own descendant", async () => {
    const unique = randomUUID().slice(0, 8);
    const parent = await createCategory({ name: `Cycle Parent ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(parent.id);
    const child = await createCategory(
      { name: `Cycle Child ${unique}`, section: "GENERAL", parentId: parent.id },
      adminId,
    );
    createdCategoryIds.push(child.id);

    await assert.rejects(
      () => updateCategory(parent.id, { parentId: child.id }, adminId),
      CategoryCycleError,
    );
  });

  it("updateCategory rejects setting itself as its own parent", async () => {
    const category = await createCategory({ name: `Self Parent ${randomUUID().slice(0, 8)}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(category.id);

    await assert.rejects(
      () => updateCategory(category.id, { parentId: category.id }, adminId),
      CategoryCycleError,
    );
  });

  it("updateCategory throws CategoryNotFoundError for an unknown id", async () => {
    await assert.rejects(() => updateCategory("does-not-exist", { name: "x" }, adminId), CategoryNotFoundError);
  });

  it("deleteCategory is blocked when the category has children, and succeeds once they're gone", async () => {
    const unique = randomUUID().slice(0, 8);
    const parent = await createCategory({ name: `Del Parent ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(parent.id);
    const child = await createCategory(
      { name: `Del Child ${unique}`, section: "GENERAL", parentId: parent.id },
      adminId,
    );
    createdCategoryIds.push(child.id);

    await assert.rejects(() => deleteCategory(parent.id, adminId), CategoryDeleteBlockedError);

    await deleteCategory(child.id, adminId);
    createdCategoryIds.splice(createdCategoryIds.indexOf(child.id), 1);

    await deleteCategory(parent.id, adminId);
    createdCategoryIds.splice(createdCategoryIds.indexOf(parent.id), 1);

    assert.equal(await db.category.findUnique({ where: { id: parent.id } }), null);
  });

  it("deleteCategory is blocked when the category has products", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await createCategory({ name: `Has Products ${unique}`, section: "GENERAL" }, adminId);
    createdCategoryIds.push(category.id);

    const product = await db.product.create({
      data: {
        slug: `test-product-${unique}`,
        name: `Test Product ${unique}`,
        categoryId: category.id,
        price: 100,
      },
    });
    createdProductIds.push(product.id);

    const error = await deleteCategory(category.id, adminId).catch((e) => e);
    assert.ok(error instanceof CategoryDeleteBlockedError);
    assert.equal((error as CategoryDeleteBlockedError).productCount, 1);
  });

  it("deleteCategory throws CategoryNotFoundError for an unknown id", async () => {
    await assert.rejects(() => deleteCategory("does-not-exist", adminId), CategoryNotFoundError);
  });
});

describe("size charts admin service (Phase B2)", () => {
  let adminId: string;

  before(async () => {
    adminId = await findAnyAdminId();
  });

  const validInput = {
    name: "",
    unit: "IN" as const,
    columns: ["Size", "Chest"],
    rows: [["S", "36"], ["M", "38"]],
    notes: null,
  };

  it("createSizeChart persists columns and rows as JSON", async () => {
    const input = { ...validInput, name: `Test Chart ${randomUUID().slice(0, 8)}` };
    const chart = await createSizeChart(input, adminId);
    createdSizeChartIds.push(chart.id);

    assert.deepEqual(chart.columns, input.columns);
    assert.deepEqual(chart.rows, input.rows);
  });

  it("updateSizeChart replaces the table", async () => {
    const input = { ...validInput, name: `Update Chart ${randomUUID().slice(0, 8)}` };
    const chart = await createSizeChart(input, adminId);
    createdSizeChartIds.push(chart.id);

    const updated = await updateSizeChart(
      chart.id,
      { ...input, columns: ["Size", "Chest", "Waist"], rows: [["S", "36", "30"]] },
      adminId,
    );
    assert.deepEqual(updated.columns, ["Size", "Chest", "Waist"]);
    assert.deepEqual(updated.rows, [["S", "36", "30"]]);
  });

  it("updateSizeChart throws SizeChartNotFoundError for an unknown id", async () => {
    await assert.rejects(() => updateSizeChart("does-not-exist", validInput, adminId), SizeChartNotFoundError);
  });

  it("deleteSizeChart is blocked while assigned to a category, and succeeds once unassigned", async () => {
    const input = { ...validInput, name: `In Use Chart ${randomUUID().slice(0, 8)}` };
    const chart = await createSizeChart(input, adminId);
    createdSizeChartIds.push(chart.id);

    const category = await createCategory(
      { name: `Chart User ${randomUUID().slice(0, 8)}`, section: "GENERAL", sizeChartId: chart.id },
      adminId,
    );
    createdCategoryIds.push(category.id);

    const error = await deleteSizeChart(chart.id, adminId).catch((e) => e);
    assert.ok(error instanceof SizeChartInUseError);
    assert.equal((error as SizeChartInUseError).categoryCount, 1);

    await updateCategory(category.id, { sizeChartId: null }, adminId);
    await deleteSizeChart(chart.id, adminId);
    createdSizeChartIds.splice(createdSizeChartIds.indexOf(chart.id), 1);

    assert.equal(await db.sizeChart.findUnique({ where: { id: chart.id } }), null);
  });

  it("deleteSizeChart throws SizeChartNotFoundError for an unknown id", async () => {
    await assert.rejects(() => deleteSizeChart("does-not-exist", adminId), SizeChartNotFoundError);
  });
});

describe("categories/size-charts admin routes without a session", () => {
  const idParams = Promise.resolve({ id: "any-id" });

  it("GET /api/admin/categories rejects with 401/403", async () => {
    const response = await getCategories();
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/categories rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", section: "GENERAL" }),
    });
    const response = await postCategory(request);
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/categories/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/categories/any-id");
    const response = await getCategory(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("PATCH /api/admin/categories/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/categories/any-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const response = await patchCategory(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("DELETE /api/admin/categories/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/categories/any-id", { method: "DELETE" });
    const response = await deleteCategoryRoute(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/categories/[id]/reorder rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/categories/any-id/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "up" }),
    });
    const response = await reorderCategoryRoute(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/size-charts rejects with 401/403", async () => {
    const response = await getSizeCharts();
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("POST /api/admin/size-charts rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/size-charts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", unit: "IN", columns: ["A"], rows: [["1"]] }),
    });
    const response = await postSizeChart(request);
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/size-charts/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/size-charts/any-id");
    const response = await getSizeChart(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("PATCH /api/admin/size-charts/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/size-charts/any-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", unit: "IN", columns: ["A"], rows: [["1"]] }),
    });
    const response = await patchSizeChart(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("DELETE /api/admin/size-charts/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/size-charts/any-id", { method: "DELETE" });
    const response = await deleteSizeChartRoute(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/products/export rejects with 401/403", async () => {
    const response = await exportProducts(new Request("http://localhost/api/admin/products/export"));
    assert.ok(response.status === 401 || response.status === 403);
  });
});

/**
 * F-290: GET /api/admin/products/export used to leave no audit trail —
 * see the matching test/fix in tests/integration/orders-admin.test.ts's
 * "orders export audit trail (F-290)" for why this exercises
 * `logAuditEvent` directly rather than the route (no real admin session
 * is obtainable outside an actual Next.js request in this harness).
 */
describe("products export audit trail (F-290)", () => {
  it("an unauthenticated export request never writes an audit row", async () => {
    const before = new Date();
    const response = await exportProducts(new Request("http://localhost/api/admin/products/export"));
    assert.ok(response.status === 401 || response.status === 403);

    const rows = await db.auditLog.findMany({
      where: { action: "export", entity: "product", createdAt: { gte: before } },
    });
    assert.equal(rows.length, 0, "a rejected (no-session) export must not be logged");
  });

  it("logging an export writes a row an owner can trace back to the requesting admin and filters used", async () => {
    const adminId = await findAnyAdminId();
    const { logAuditEvent } = await import("@/lib/auth/audit");
    const filters = { categorySlug: "scrubs", status: "ACTIVE" };

    await logAuditEvent({ userId: adminId, action: "export", entity: "product", metadata: { filters } });

    const rows = await db.auditLog.findMany({
      where: { userId: adminId, action: "export", entity: "product" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0]!.metadata ?? "{}"), { filters });
  });
});
