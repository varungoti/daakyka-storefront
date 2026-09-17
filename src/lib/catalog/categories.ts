import { revalidateTag } from "next/cache";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG } from "@/lib/products";
import type { Category, CategorySection, Prisma } from "@/generated/prisma/client";
import {
  categorySectionValues,
  slugify,
  wouldCreateCategoryCycle,
} from "@/lib/catalog/category-validation";

/**
 * Phase B2: admin CRUD for `Category`, on top of the read path already
 * built in src/lib/products/index.ts (Phase B3). This module owns the
 * write side — validation, cycle prevention, delete guards — used by
 * src/app/api/admin/categories/**\/route.ts and directly by integration
 * tests (route handlers can't fabricate an authenticated session outside
 * a real Next.js request, so the create/update/delete *rules* are
 * exercised here instead — see tests/integration/catalog-admin.test.ts).
 *
 * `categorySectionValues` and `SECTION_LABELS` live in
 * category-validation.ts (no Prisma import) and are just re-exported here
 * for server-side callers — client components must import them from
 * category-validation.ts directly, never from this module (see that
 * file's header comment).
 */

export { categorySectionValues, SECTION_LABELS } from "@/lib/catalog/category-validation";

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only");

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  slug: slugField.optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  section: z.enum(categorySectionValues),
  parentId: z.string().trim().min(1).max(60).optional().nullable(),
  imageId: z.string().trim().min(1).max(60).optional().nullable(),
  sizeChartId: z.string().trim().min(1).max(60).optional().nullable(),
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(300).optional().nullable(),
  active: z.boolean().optional(),
  showInMenu: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const categoryUpdateSchema = categoryInputSchema.partial();
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export class CategoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Category ${id} not found`);
    this.name = "CategoryNotFoundError";
  }
}

export class CategorySlugConflictError extends Error {
  constructor(slug: string) {
    super(`Slug "${slug}" is already in use by another category`);
    this.name = "CategorySlugConflictError";
  }
}

export class CategoryParentNotFoundError extends Error {
  constructor(id: string) {
    super(`Parent category ${id} not found`);
    this.name = "CategoryParentNotFoundError";
  }
}

export class CategorySectionMismatchError extends Error {
  constructor() {
    super("A category's parent must be in the same section");
    this.name = "CategorySectionMismatchError";
  }
}

export class CategoryCycleError extends Error {
  constructor() {
    super("That parent would create a cycle in the category tree");
    this.name = "CategoryCycleError";
  }
}

export class CategoryDeleteBlockedError extends Error {
  constructor(
    public readonly productCount: number,
    public readonly childCount: number,
  ) {
    super(
      [
        productCount > 0 ? `${productCount} product${productCount === 1 ? "" : "s"}` : null,
        childCount > 0 ? `${childCount} sub-categor${childCount === 1 ? "y" : "ies"}` : null,
      ]
        .filter(Boolean)
        .join(" and ") + " must be moved or removed before this category can be deleted",
    );
    this.name = "CategoryDeleteBlockedError";
  }
}

export class SizeChartRefNotFoundError extends Error {
  constructor(id: string) {
    super(`Size chart ${id} not found`);
    this.name = "SizeChartRefNotFoundError";
  }
}

function safeRevalidate(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // No static generation store in this context (unit/integration tests,
    // one-off scripts) — nothing to revalidate. Matches the pattern in
    // src/lib/settings/index.ts.
  }
}

function revalidateCatalog() {
  safeRevalidate(CATEGORIES_CACHE_TAG);
  safeRevalidate(PRODUCTS_CACHE_TAG);
}

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  const existing = await db.category.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== excludeId) {
    throw new CategorySlugConflictError(slug);
  }
}

async function assertSizeChartExists(id: string): Promise<void> {
  const chart = await db.sizeChart.findUnique({ where: { id }, select: { id: true } });
  if (!chart) throw new SizeChartRefNotFoundError(id);
}

/** Validates a (possibly new) parent assignment: the parent must exist,
 * must be in the same section, and — when updating an existing category —
 * must not create a cycle. */
async function assertValidParent(
  parentId: string,
  section: CategorySection,
  selfId: string | null,
): Promise<void> {
  const parent = await db.category.findUnique({
    where: { id: parentId },
    select: { id: true, section: true },
  });
  if (!parent) throw new CategoryParentNotFoundError(parentId);
  if (parent.section !== section) throw new CategorySectionMismatchError();

  if (selfId) {
    const all = await db.category.findMany({ select: { id: true, parentId: true } });
    if (wouldCreateCategoryCycle(selfId, parentId, all)) {
      throw new CategoryCycleError();
    }
  }
}

export async function createCategory(input: CategoryInput, userId: string): Promise<Category> {
  const name = input.name.trim();
  const slug = slugify(input.slug ?? name);
  await assertSlugAvailable(slug);

  if (input.parentId) {
    await assertValidParent(input.parentId, input.section, null);
  }
  if (input.sizeChartId) {
    await assertSizeChartExists(input.sizeChartId);
  }

  const created = await db.category.create({
    data: {
      name,
      slug,
      description: input.description ?? null,
      section: input.section,
      parentId: input.parentId ?? null,
      imageId: input.imageId ?? null,
      sizeChartId: input.sizeChartId ?? null,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      active: input.active ?? true,
      showInMenu: input.showInMenu ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "category",
    entityId: created.id,
    metadata: { name: created.name, slug: created.slug, section: created.section },
  });

  revalidateCatalog();
  return created;
}

export async function updateCategory(
  id: string,
  input: CategoryUpdateInput,
  userId: string,
): Promise<Category> {
  const existing = await db.category.findUnique({ where: { id } });
  if (!existing) throw new CategoryNotFoundError(id);

  const nextSection = input.section ?? existing.section;

  let nextSlug = existing.slug;
  if (input.slug !== undefined) {
    nextSlug = slugify(input.slug);
    if (nextSlug !== existing.slug) {
      await assertSlugAvailable(nextSlug, id);
    }
  }

  if (input.parentId !== undefined && input.parentId !== null) {
    await assertValidParent(input.parentId, nextSection, id);
  } else if (input.parentId === undefined && input.section && input.section !== existing.section && existing.parentId) {
    // Section changed without an explicit parent change — re-validate the
    // existing parent is still in the (new) section.
    await assertValidParent(existing.parentId, nextSection, id);
  }

  if (input.sizeChartId) {
    await assertSizeChartExists(input.sizeChartId);
  }

  const data: Prisma.CategoryUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.slug !== undefined) data.slug = nextSlug;
  if (input.description !== undefined) data.description = input.description;
  if (input.section !== undefined) data.section = input.section;
  if (input.parentId !== undefined) {
    data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
  }
  if (input.imageId !== undefined) {
    data.image = input.imageId ? { connect: { id: input.imageId } } : { disconnect: true };
  }
  if (input.sizeChartId !== undefined) {
    data.sizeChart = input.sizeChartId ? { connect: { id: input.sizeChartId } } : { disconnect: true };
  }
  if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) data.seoDescription = input.seoDescription;
  if (input.active !== undefined) data.active = input.active;
  if (input.showInMenu !== undefined) data.showInMenu = input.showInMenu;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  const updated = await db.category.update({ where: { id }, data });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "category",
    entityId: updated.id,
    metadata: { name: updated.name, slug: updated.slug },
  });

  revalidateCatalog();
  return updated;
}

export async function deleteCategory(id: string, userId: string): Promise<void> {
  const existing = await db.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true, children: true } } },
  });
  if (!existing) throw new CategoryNotFoundError(id);

  if (existing._count.products > 0 || existing._count.children > 0) {
    throw new CategoryDeleteBlockedError(existing._count.products, existing._count.children);
  }

  await db.category.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "category",
    entityId: id,
    metadata: { name: existing.name, slug: existing.slug },
  });

  revalidateCatalog();
}

/** Swaps sortOrder with the previous/next sibling (same parentId), so the
 * admin tree's up/down controls can reorder without a full drag-and-drop
 * implementation. No-op (returns false) at either end of the list. */
export async function reorderCategory(id: string, direction: "up" | "down", userId: string): Promise<boolean> {
  const existing = await db.category.findUnique({ where: { id } });
  if (!existing) throw new CategoryNotFoundError(id);

  const siblings = await db.category.findMany({
    where: { parentId: existing.parentId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, sortOrder: true },
  });

  const index = siblings.findIndex((s) => s.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= siblings.length) return false;

  const other = siblings[swapIndex];
  const self = siblings[index];

  await db.$transaction([
    db.category.update({ where: { id: self.id }, data: { sortOrder: other.sortOrder } }),
    db.category.update({ where: { id: other.id }, data: { sortOrder: self.sortOrder } }),
  ]);

  await logAuditEvent({
    userId,
    action: "update",
    entity: "category",
    entityId: id,
    metadata: { reorder: direction },
  });

  revalidateCatalog();
  return true;
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export interface AdminCategoryNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  section: CategorySection;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  showInMenu: boolean;
  sizeChartId: string | null;
  sizeChartName: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  image: { id: string; url: string; alt: string | null } | null;
  productCount: number;
  childCount: number;
  createdAt: Date;
  children: AdminCategoryNode[];
}

const ADMIN_CATEGORY_INCLUDE = {
  image: { select: { id: true, url: true, alt: true } },
  sizeChart: { select: { id: true, name: true } },
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategoryInclude;

type AdminCategoryRow = Prisma.CategoryGetPayload<{ include: typeof ADMIN_CATEGORY_INCLUDE }>;

function toAdminNode(row: AdminCategoryRow): AdminCategoryNode {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    section: row.section,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    active: row.active,
    showInMenu: row.showInMenu,
    sizeChartId: row.sizeChartId,
    sizeChartName: row.sizeChart?.name ?? null,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    image: row.image,
    productCount: row._count.products,
    childCount: row._count.children,
    createdAt: row.createdAt,
    children: [],
  };
}

/** Every category (active or not), nested into a parent/child tree and
 * sorted by sortOrder within each level. Unlike the storefront's
 * getCategoryTree() (src/lib/products/index.ts), this includes inactive
 * categories and per-node counts, and is never cached — the admin screen
 * always wants the latest state. */
export async function listCategoriesForAdmin(): Promise<AdminCategoryNode[]> {
  const rows = await db.category.findMany({
    include: ADMIN_CATEGORY_INCLUDE,
    orderBy: { sortOrder: "asc" },
  });

  const nodeById = new Map(rows.map((r) => [r.id, toAdminNode(r)]));
  const roots: AdminCategoryNode[] = [];

  for (const row of rows) {
    const node = nodeById.get(row.id)!;
    if (row.parentId && nodeById.has(row.parentId)) {
      nodeById.get(row.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: AdminCategoryNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  return roots;
}

export async function getCategoryForAdmin(id: string): Promise<AdminCategoryNode> {
  const row = await db.category.findUnique({ where: { id }, include: ADMIN_CATEGORY_INCLUDE });
  if (!row) throw new CategoryNotFoundError(id);
  return toAdminNode(row);
}

/** Flat list of {id, name, section} for parent/size-chart pickers in the
 * admin form — cheap enough to fetch in full (dozens of categories). */
export async function listCategoryOptions(): Promise<
  { id: string; name: string; section: CategorySection; parentId: string | null }[]
> {
  return db.category.findMany({
    select: { id: true, name: true, section: true, parentId: true },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
  });
}
