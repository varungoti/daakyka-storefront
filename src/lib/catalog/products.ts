import { revalidateTag } from "next/cache";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG, productCacheTag } from "@/lib/products";
import type { Prisma, Product, ProductGender, ProductStatus } from "@/generated/prisma/client";
import { slugify } from "@/lib/catalog/category-validation";
import { assertUniqueVariants, generateSku } from "@/lib/catalog/product-validation";
import { prepareDescriptionForStorage } from "@/lib/catalog/description-html";

/**
 * Phase B1: admin CRUD for `Product`, `ProductVariant`, and `ProductImage`,
 * on top of the read path in src/lib/products/index.ts (Phase B3) and
 * mirroring the shape of src/lib/catalog/categories.ts (Phase B2) — zod
 * input schemas, named Error subclasses per failure mode, an audit log
 * entry and a cache revalidation after every write.
 */

export const productGenderValues = ["MEN", "WOMEN", "UNISEX", "BOYS", "GIRLS", "KIDS"] as const;
export const productStatusValues = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional().nullable();

/** Shared by createProduct/updateProduct's status-transition guard (F-063)
 * and the publish-content guard (F-028) — kept here, next to the schemas
 * they gate, rather than duplicated at each call site. */
export interface ProductWriteOptions {
  /** Whether the caller holds `products:publish` — required to move a
   * product to ACTIVE, or off ACTIVE back to DRAFT (an unpublish). Moving
   * ACTIVE -> ARCHIVED stays under `products:manage` alone, matching
   * publishProduct/archiveProduct's own split in
   * src/app/api/admin/products/[id]/publish/route.ts. Defaults to `true`
   * so existing callers (tests, scripts) that don't pass this option keep
   * working unrestricted — the two admin routes are the only callers that
   * narrow it based on the caller's real role. */
  canPublish?: boolean;
}

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only")
    .optional(),
  shortDescription: optionalTrimmed(300),
  // F-12: now rich-text HTML (sanitized in createProduct/updateProduct via
  // prepareDescriptionForStorage) rather than always-plain text, so the
  // ceiling is higher than 5000 to leave headroom for markup overhead
  // (tags, entity-escaped characters) around the same amount of visible
  // text a plain textarea would have allowed.
  description: optionalTrimmed(8000),
  categoryId: z.string().trim().min(1, "Category is required"),
  status: z.enum(productStatusValues).optional(),
  featured: z.boolean().optional(),
  isNew: z.boolean().optional(),
  price: z.number().positive("Price must be greater than 0"),
  compareAtPrice: z.number().positive().optional().nullable(),
  gender: z.enum(productGenderValues).optional(),
  fabric: optionalTrimmed(200),
  care: optionalTrimmed(500),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  sizeChartId: z.string().trim().min(1).max(60).optional().nullable(),
  seoTitle: optionalTrimmed(200),
  seoDescription: optionalTrimmed(300),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const productUpdateSchema = productInputSchema.partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

const variantSchema = z.object({
  // F-023/F-336: present for a variant the admin form already loaded from
  // the DB — matches it to the existing row instead of a fresh delete +
  // recreate. Absent for a brand-new row (not yet persisted).
  id: z.string().trim().min(1).optional(),
  size: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(60),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  sku: z.string().trim().min(1).max(80),
  price: z.number().positive().optional().nullable(),
  stock: z.number().int().min(0).max(1_000_000),
  // F-023/F-336: the stock value the form loaded (or last synced) for this
  // row — used as a compare-and-set precondition so `stock` is only ever
  // written when it actually changed, and a write that would clobber a
  // sale made since the page opened is rejected with a conflict instead of
  // silently overwriting it. Omitted for a new row, or by a caller that
  // hasn't opted into the check (see replaceVariants' doc comment).
  expectedStock: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

export const variantsInputSchema = z.object({
  variants: z.array(variantSchema).max(200),
});

export type VariantInput = z.infer<typeof variantSchema>;

const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), ids: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({ action: z.literal("archive"), ids: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({
    action: z.literal("move-category"),
    ids: z.array(z.string().min(1)).min(1).max(500),
    categoryId: z.string().min(1),
  }),
  z.object({
    action: z.literal("adjust-price-pct"),
    ids: z.array(z.string().min(1)).min(1).max(500),
    percent: z.number().min(-90).max(500),
  }),
  z.object({
    action: z.literal("set-stock"),
    ids: z.array(z.string().min(1)).min(1).max(500),
    stock: z.number().int().min(0).max(1_000_000),
  }),
]);

export type BulkActionInput = z.infer<typeof bulkActionSchema>;
export { bulkActionSchema };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Product ${id} not found`);
    this.name = "ProductNotFoundError";
  }
}

export class ProductSlugConflictError extends Error {
  constructor(slug: string) {
    super(`Slug "${slug}" is already in use by another product`);
    this.name = "ProductSlugConflictError";
  }
}

export class ProductCategoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Category ${id} not found`);
    this.name = "ProductCategoryNotFoundError";
  }
}

export class ProductSizeChartNotFoundError extends Error {
  constructor(id: string) {
    super(`Size chart ${id} not found`);
    this.name = "ProductSizeChartNotFoundError";
  }
}

export class ProductDeleteBlockedError extends Error {
  constructor(public readonly orderCount: number) {
    super(`This product has ${orderCount} order item(s) and can't be deleted — archive it instead`);
    this.name = "ProductDeleteBlockedError";
  }
}

export class ProductNotDraftError extends Error {
  constructor() {
    super("Only draft products with no orders can be deleted");
    this.name = "ProductNotDraftError";
  }
}

export class ProductImageNotFoundError extends Error {
  constructor(id: string) {
    super(`Product image ${id} not found`);
    this.name = "ProductImageNotFoundError";
  }
}

export class InvalidCompareAtPriceError extends Error {
  constructor() {
    super("Compare-at price must be greater than the price");
    this.name = "InvalidCompareAtPriceError";
  }
}

/** F-028: thrown by publishProduct, performBulkAction's "publish" case (per
 * skipped row, not thrown), and createProduct/updateProduct when the
 * caller asks for status ACTIVE on a product with no active variant — a
 * product like this shows as buyable on the storefront but can never
 * actually be checked out (see src/lib/products/index.ts's `available`
 * computation and AddToCartButton's seed-id fallback). */
export class ProductNotPublishableError extends Error {
  constructor(message = "Add at least one active variant before publishing") {
    super(message);
    this.name = "ProductNotPublishableError";
  }
}

/** F-063: thrown by updateProduct when the caller's ProductWriteOptions
 * says they lack `products:publish` but the requested status change would
 * move the product to or off ACTIVE — the one control CATALOG_MANAGER is
 * documented (src/lib/auth/rbac.ts) as not having, previously reachable
 * anyway by sending `status` straight to this PATCH instead of going
 * through the dedicated, correctly-gated /publish route. */
export class ProductStatusPermissionError extends Error {
  constructor() {
    super("Changing publish status requires products:publish");
    this.name = "ProductStatusPermissionError";
  }
}

export class VariantOwnershipError extends Error {
  constructor(id: string) {
    super(`Variant ${id} does not belong to this product`);
    this.name = "VariantOwnershipError";
  }
}

/** F-023/F-336: thrown by replaceVariants when a row's `stock` differs
 * from its `expectedStock` (the admin edited it) but the row's current DB
 * stock no longer matches `expectedStock` either — someone else (a sale, a
 * restock, another admin) changed it since this page loaded, so writing
 * the admin's value would silently undo that change. */
export class VariantStockConflictError extends Error {
  constructor(public readonly sku: string) {
    super(`Stock for "${sku}" changed since this page was loaded — reload to see the current value`);
    this.name = "VariantStockConflictError";
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function safeRevalidate(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // No static generation store in this context (unit/integration tests,
    // one-off scripts) — nothing to revalidate.
  }
}

function revalidateProduct(slug?: string, categoryChanged = false) {
  safeRevalidate(PRODUCTS_CACHE_TAG);
  if (slug) safeRevalidate(productCacheTag(slug));
  if (categoryChanged) safeRevalidate(CATEGORIES_CACHE_TAG);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== excludeId) {
    throw new ProductSlugConflictError(slug);
  }
}

async function getCategoryOrThrow(categoryId: string) {
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true, slug: true, sizeChartId: true } });
  if (!category) throw new ProductCategoryNotFoundError(categoryId);
  return category;
}

async function assertSizeChartExists(id: string): Promise<void> {
  const chart = await db.sizeChart.findUnique({ where: { id }, select: { id: true } });
  if (!chart) throw new ProductSizeChartNotFoundError(id);
}

/** F-028: whether a product has at least one *active* variant — the bar
 * for "publishable", regardless of stock (a sold-out product must stay
 * publishable so the sold-out/notify-me UI has something to show). */
async function hasActiveVariant(productId: string): Promise<boolean> {
  const count = await db.productVariant.count({ where: { productId, active: true } });
  return count > 0;
}

/** Generates a unique slug from `base`, appending -2, -3, ... if needed. */
export async function generateUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let attempt = 1;
  // Bounded loop — a pathological number of collisions is effectively
  // impossible in practice, but this keeps it from looping forever.
  while (attempt < 1000) {
    const existing = await db.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    attempt += 1;
    candidate = `${root}-${attempt}`;
  }
  throw new ProductSlugConflictError(root);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createProduct(input: ProductInput, userId: string): Promise<Product> {
  const category = await getCategoryOrThrow(input.categoryId);

  if (input.compareAtPrice != null && input.compareAtPrice <= input.price) {
    throw new InvalidCompareAtPriceError();
  }

  // F-028: a product being created has no variants yet (those are added
  // through a separate save after this one returns an id), so it can
  // never legitimately be created already ACTIVE — publish it afterwards,
  // once it has at least one active variant, through publishProduct.
  if (input.status === "ACTIVE") {
    throw new ProductNotPublishableError();
  }

  const slug = input.slug ? slugify(input.slug) : await generateUniqueSlug(input.name);
  if (input.slug) await assertSlugAvailable(slug);

  if (input.sizeChartId) await assertSizeChartExists(input.sizeChartId);

  const created = await db.product.create({
    data: {
      name: input.name.trim(),
      slug,
      shortDescription: input.shortDescription ?? null,
      // F-12: sanitize on the way in — the one place a description is
      // safe to persist (see description-html.ts's file comment).
      description: prepareDescriptionForStorage(input.description),
      categoryId: category.id,
      status: input.status ?? "DRAFT",
      featured: input.featured ?? false,
      isNew: input.isNew ?? false,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      gender: (input.gender ?? "UNISEX") as ProductGender,
      fabric: input.fabric ?? null,
      care: input.care ?? null,
      tags: input.tags ?? [],
      sizeChartId: input.sizeChartId ?? category.sizeChartId ?? null,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      createdById: userId,
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "product",
    entityId: created.id,
    metadata: { name: created.name, slug: created.slug, status: created.status },
  });

  revalidateProduct(created.slug, true);
  return created;
}

export async function updateProduct(
  id: string,
  input: ProductUpdateInput,
  userId: string,
  options: ProductWriteOptions = {},
): Promise<Product> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);

  const nextPrice = input.price ?? Number(existing.price);
  const nextCompareAt = input.compareAtPrice !== undefined ? input.compareAtPrice : existing.compareAtPrice ? Number(existing.compareAtPrice) : null;
  if (nextCompareAt != null && nextCompareAt <= nextPrice) {
    throw new InvalidCompareAtPriceError();
  }

  // F-063/F-028: only look at this when the caller is actually attempting
  // a status *change* — an ordinary field edit that happens to re-send the
  // product's current, unchanged status (the admin form does this on
  // every save) must never trip either guard.
  if (input.status !== undefined && input.status !== existing.status) {
    // Moving to ACTIVE, or off ACTIVE back to DRAFT (an unpublish), is
    // "publishing" in the RBAC sense the dedicated /publish route already
    // enforces — see that route's own doc comment. ACTIVE -> ARCHIVED
    // stays under products:manage alone, matching it: `existing.status ===
    // "ACTIVE"` alone would also catch that case (it's a change *off*
    // ACTIVE too), so the unpublish leg is narrowed to landing on DRAFT
    // specifically.
    const isPublishTransition = input.status === "ACTIVE" || (existing.status === "ACTIVE" && input.status === "DRAFT");
    if (isPublishTransition && options.canPublish === false) {
      throw new ProductStatusPermissionError();
    }
    if (input.status === "ACTIVE" && !(await hasActiveVariant(id))) {
      throw new ProductNotPublishableError();
    }
  }

  let nextSlug = existing.slug;
  if (input.slug !== undefined) {
    nextSlug = slugify(input.slug);
    if (nextSlug !== existing.slug) await assertSlugAvailable(nextSlug, id);
  }

  let categoryChanged = false;
  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
    await getCategoryOrThrow(input.categoryId);
    categoryChanged = true;
  }

  if (input.sizeChartId) await assertSizeChartExists(input.sizeChartId);

  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.slug !== undefined) data.slug = nextSlug;
  if (input.shortDescription !== undefined) data.shortDescription = input.shortDescription;
  if (input.description !== undefined) data.description = prepareDescriptionForStorage(input.description);
  if (input.categoryId !== undefined) data.category = { connect: { id: input.categoryId } };
  if (input.status !== undefined) data.status = input.status;
  if (input.featured !== undefined) data.featured = input.featured;
  if (input.isNew !== undefined) data.isNew = input.isNew;
  if (input.price !== undefined) data.price = input.price;
  if (input.compareAtPrice !== undefined) data.compareAtPrice = input.compareAtPrice;
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.fabric !== undefined) data.fabric = input.fabric;
  if (input.care !== undefined) data.care = input.care;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.sizeChartId !== undefined) {
    data.sizeChart = input.sizeChartId ? { connect: { id: input.sizeChartId } } : { disconnect: true };
  }
  if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) data.seoDescription = input.seoDescription;

  const updated = await db.product.update({ where: { id }, data });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "product",
    entityId: updated.id,
    metadata: { name: updated.name, slug: updated.slug },
  });

  revalidateProduct(updated.slug, categoryChanged);
  if (existing.slug !== updated.slug) revalidateProduct(existing.slug);
  return updated;
}

async function countProductOrderItems(productId: string): Promise<number> {
  return db.orderItem.count({ where: { variant: { productId } } });
}

export async function deleteProduct(id: string, userId: string): Promise<void> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);

  if (existing.status !== "DRAFT") {
    throw new ProductNotDraftError();
  }

  const orderCount = await countProductOrderItems(id);
  if (orderCount > 0) {
    throw new ProductDeleteBlockedError(orderCount);
  }

  await db.product.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "product",
    entityId: id,
    metadata: { name: existing.name, slug: existing.slug },
  });

  revalidateProduct(existing.slug, true);
}

export async function publishProduct(id: string, userId: string): Promise<Product> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);
  if (!(await hasActiveVariant(id))) throw new ProductNotPublishableError();

  const updated = await db.product.update({ where: { id }, data: { status: "ACTIVE" } });

  await logAuditEvent({ userId, action: "publish", entity: "product", entityId: id, metadata: { slug: updated.slug } });
  revalidateProduct(updated.slug);
  return updated;
}

export async function unpublishProduct(id: string, userId: string): Promise<Product> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);

  const updated = await db.product.update({ where: { id }, data: { status: "DRAFT" } });

  await logAuditEvent({ userId, action: "unpublish", entity: "product", entityId: id, metadata: { slug: updated.slug } });
  revalidateProduct(updated.slug);
  return updated;
}

export async function archiveProduct(id: string, userId: string): Promise<Product> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);

  const updated = await db.product.update({ where: { id }, data: { status: "ARCHIVED" } });

  await logAuditEvent({ userId, action: "archive", entity: "product", entityId: id, metadata: { slug: updated.slug } });
  revalidateProduct(updated.slug);
  return updated;
}

export async function duplicateProduct(id: string, userId: string): Promise<Product> {
  const existing = await db.product.findUnique({
    where: { id },
    include: { variants: true, images: true, category: { select: { name: true } } },
  });
  if (!existing) throw new ProductNotFoundError(id);

  const newSlug = await generateUniqueSlug(`${existing.name}-copy`);

  const created = await db.product.create({
    data: {
      name: `${existing.name} (copy)`,
      slug: newSlug,
      shortDescription: existing.shortDescription,
      description: existing.description,
      categoryId: existing.categoryId,
      status: "DRAFT",
      featured: false,
      isNew: existing.isNew,
      price: existing.price,
      compareAtPrice: existing.compareAtPrice,
      gender: existing.gender,
      fabric: existing.fabric,
      care: existing.care,
      tags: existing.tags,
      sizeChartId: existing.sizeChartId,
      seoTitle: existing.seoTitle,
      seoDescription: existing.seoDescription,
      createdById: userId,
      variants: {
        create: existing.variants.map((v) => ({
          size: v.size,
          color: v.color,
          colorHex: v.colorHex,
          sku: generateSku({ categoryName: existing.category.name, productSlug: newSlug, size: v.size, color: v.color }),
          price: v.price,
          stock: v.stock,
          active: v.active,
        })),
      },
      images: {
        create: existing.images.map((img) => ({
          mediaId: img.mediaId,
          color: img.color,
          sortOrder: img.sortOrder,
          alt: img.alt,
        })),
      },
    },
  });

  await logAuditEvent({
    userId,
    action: "duplicate",
    entity: "product",
    entityId: created.id,
    metadata: { fromId: id, name: created.name, slug: created.slug },
  });

  revalidateProduct(created.slug, true);
  return created;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export interface SyncedVariant {
  id: string;
  size: string;
  color: string;
  colorHex: string | null;
  sku: string;
  price: number | null;
  stock: number;
  active: boolean;
}

function variantKey(size: string, color: string): string {
  return `${size.trim().toLowerCase()}::${color.trim().toLowerCase()}`;
}

/**
 * F-023/F-336 (release-hardening P0 anchor): syncs the admin form's
 * variant grid against the DB with a per-row diff instead of the old
 * `deleteMany` + `createMany`, which minted a fresh id for *every* variant
 * on *every* save — including a save that only touched an unrelated field
 * like the short description. That silently unlinked every past
 * `OrderItem` (`onDelete: SetNull`), cascade-deleted every pending
 * `BackInStockSubscription` (`onDelete: Cascade`), and broke any shopper
 * cart already holding the old variant id, because the id it stores in
 * localStorage stopped resolving to anything.
 *
 * Matching: an incoming row with an `id` (a variant the form already
 * loaded from the DB) is matched to that exact row; a row with no `id`
 * (new, never-persisted) falls back to matching an unclaimed existing row
 * by (size, color) — the same pair the DB's own
 * `@@unique([productId,size,color])` treats as the row's real identity —
 * and otherwise becomes a new row. Existing rows the incoming grid drops
 * are hard-deleted only when nothing references them; a variant with
 * order history or a pending back-in-stock signup is deactivated instead,
 * so those links and signups survive a variant being "removed" from the
 * grid.
 *
 * Stock is the one field this never blindly overwrites: it's written only
 * when the caller says it actually changed (`stock !== expectedStock`),
 * and then only as a compare-and-set against `expectedStock` — the value
 * the form loaded. If the row's real DB stock has since moved (a sale,
 * another admin, a restock), the set fails closed with
 * VariantStockConflictError instead of silently undoing that change. A
 * caller that never sends `expectedStock` at all (existing scripts/tests,
 * and the CSV importer's own separate upsert path) keeps the simpler
 * "just set it" behavior — the CAS is opt-in per row, not a schema
 * requirement.
 *
 * Two rows swapping SKUs (or size/color) in the same save can still hit
 * the DB's unique constraints mid-transaction (Postgres checks them
 * per-statement) — deletions/deactivations run first specifically to free
 * up whatever a removed row held, but a genuine swap between two rows
 * that both survive isn't resolved here; the route maps the resulting
 * P2002 to a 409 rather than a 500.
 */
export async function replaceVariants(productId: string, variants: VariantInput[], userId: string): Promise<SyncedVariant[]> {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);

  assertUniqueVariants(variants);

  // Enforce cross-product SKU uniqueness against variants belonging to
  // *other* products (the DB unique constraint would catch this too, but
  // we want a clean, typed error rather than a raw P2002).
  const skus = variants.map((v) => v.sku.trim());
  const conflicting = await db.productVariant.findMany({
    where: { sku: { in: skus }, productId: { not: productId } },
    select: { sku: true },
  });
  if (conflicting.length > 0) {
    throw new ProductSlugConflictError(`SKU "${conflicting[0].sku}" is already used by another product`);
  }

  const existing = await db.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      size: true,
      color: true,
      _count: { select: { orderItems: true, backInStockSubscriptions: true } },
    },
  });
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const existingByKey = new Map(existing.map((e) => [variantKey(e.size, e.color), e]));

  const matchedIds = new Set<string>();
  const toCreate: VariantInput[] = [];
  const toUpdate: { existing: (typeof existing)[number]; input: VariantInput }[] = [];

  for (const v of variants) {
    let match: (typeof existing)[number] | undefined;
    if (v.id) {
      match = existingById.get(v.id);
      if (!match) throw new VariantOwnershipError(v.id);
    } else {
      match = existingByKey.get(variantKey(v.size, v.color));
    }
    if (match && !matchedIds.has(match.id)) {
      matchedIds.add(match.id);
      toUpdate.push({ existing: match, input: v });
    } else {
      toCreate.push(v);
    }
  }

  const toRemove = existing.filter((e) => !matchedIds.has(e.id));

  await db.$transaction(async (tx) => {
    // Deletions/deactivations first, so a (size,color) or SKU a removed
    // row held is free for an updated row to take in the same save.
    for (const row of toRemove) {
      if (row._count.orderItems > 0 || row._count.backInStockSubscriptions > 0) {
        await tx.productVariant.update({ where: { id: row.id }, data: { active: false } });
      } else {
        await tx.productVariant.delete({ where: { id: row.id } });
      }
    }

    for (const { existing: row, input } of toUpdate) {
      const stockChanged = input.expectedStock !== undefined && input.expectedStock !== input.stock;
      // No expectedStock at all means the caller isn't opting into the
      // CAS (see the doc comment above) — write stock as given, same as
      // the old unconditional behavior.
      const applyStockUnconditionally = input.expectedStock === undefined;

      const data: Prisma.ProductVariantUpdateManyMutationInput = {
        size: input.size.trim(),
        color: input.color.trim(),
        colorHex: input.colorHex ?? null,
        sku: input.sku.trim(),
        price: input.price ?? null,
        active: input.active ?? true,
      };
      if (applyStockUnconditionally || stockChanged) data.stock = input.stock;

      const where: Prisma.ProductVariantWhereInput = { id: row.id };
      if (stockChanged) where.stock = input.expectedStock;

      const result = await tx.productVariant.updateMany({ where, data });
      if (stockChanged && result.count === 0) {
        throw new VariantStockConflictError(input.sku.trim());
      }
    }

    if (toCreate.length > 0) {
      await tx.productVariant.createMany({
        data: toCreate.map((v) => ({
          productId,
          size: v.size.trim(),
          color: v.color.trim(),
          colorHex: v.colorHex ?? null,
          sku: v.sku.trim(),
          price: v.price ?? null,
          stock: v.stock,
          active: v.active ?? true,
        })),
      });
    }
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "product_variants",
    entityId: productId,
    metadata: { count: variants.length, created: toCreate.length, updated: toUpdate.length, removed: toRemove.length },
  });

  revalidateProduct(product.slug);

  const fresh = await db.productVariant.findMany({ where: { productId }, orderBy: [{ size: "asc" }, { color: "asc" }] });
  return fresh.map((v) => ({
    id: v.id,
    size: v.size,
    color: v.color,
    colorHex: v.colorHex,
    sku: v.sku,
    price: v.price ? Number(v.price) : null,
    stock: v.stock,
    active: v.active,
  }));
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function addProductImage(
  productId: string,
  mediaAssetId: string,
  options: { color?: string | null; alt?: string | null },
  userId: string,
) {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, slug: true } });
  if (!product) throw new ProductNotFoundError(productId);

  const media = await db.mediaAsset.findUnique({ where: { id: mediaAssetId }, select: { id: true } });
  if (!media) throw new ProductImageNotFoundError(mediaAssetId);

  const maxSort = await db.productImage.aggregate({ where: { productId }, _max: { sortOrder: true } });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const image = await db.productImage.create({
    data: { productId, mediaId: mediaAssetId, color: options.color ?? null, alt: options.alt ?? null, sortOrder: nextSort },
    include: { media: true },
  });

  await logAuditEvent({ userId, action: "create", entity: "product_image", entityId: image.id, metadata: { productId } });
  revalidateProduct(product.slug);
  return image;
}

export async function removeProductImage(imageId: string, userId: string): Promise<void> {
  const image = await db.productImage.findUnique({ where: { id: imageId }, include: { product: { select: { slug: true } } } });
  if (!image) throw new ProductImageNotFoundError(imageId);

  await db.productImage.delete({ where: { id: imageId } });

  await logAuditEvent({ userId, action: "delete", entity: "product_image", entityId: imageId, metadata: { productId: image.productId } });
  revalidateProduct(image.product.slug);
}

export async function setImageColor(imageId: string, color: string | null, userId: string) {
  const image = await db.productImage.findUnique({ where: { id: imageId }, include: { product: { select: { slug: true } } } });
  if (!image) throw new ProductImageNotFoundError(imageId);

  const updated = await db.productImage.update({ where: { id: imageId }, data: { color }, include: { media: true } });

  await logAuditEvent({ userId, action: "update", entity: "product_image", entityId: imageId, metadata: { color } });
  revalidateProduct(image.product.slug);
  return updated;
}

export async function updateImageAlt(imageId: string, alt: string | null, userId: string) {
  const image = await db.productImage.findUnique({ where: { id: imageId }, include: { product: { select: { slug: true } } } });
  if (!image) throw new ProductImageNotFoundError(imageId);

  const updated = await db.productImage.update({ where: { id: imageId }, data: { alt }, include: { media: true } });

  await logAuditEvent({ userId, action: "update", entity: "product_image", entityId: imageId, metadata: { alt } });
  revalidateProduct(image.product.slug);
  return updated;
}

/** Swaps sortOrder with the previous/next sibling image on the same
 * product — mirrors reorderCategory's up/down approach rather than full
 * drag-and-drop. No-op (returns false) at either end of the list. */
export async function reorderProductImages(productId: string, imageId: string, direction: "up" | "down", userId: string): Promise<boolean> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, slug: true } });
  if (!product) throw new ProductNotFoundError(productId);

  const siblings = await db.productImage.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, sortOrder: true },
  });

  const index = siblings.findIndex((s) => s.id === imageId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= siblings.length) return false;

  const self = siblings[index];
  const other = siblings[swapIndex];

  await db.$transaction([
    db.productImage.update({ where: { id: self.id }, data: { sortOrder: other.sortOrder } }),
    db.productImage.update({ where: { id: other.id }, data: { sortOrder: self.sortOrder } }),
  ]);

  await logAuditEvent({ userId, action: "update", entity: "product_image", entityId: imageId, metadata: { reorder: direction } });
  revalidateProduct(product.slug);
  return true;
}

// ---------------------------------------------------------------------------
// Admin reads / list
// ---------------------------------------------------------------------------

export interface AdminProductListItem {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  price: number;
  compareAtPrice: number | null;
  totalStock: number;
  status: ProductStatus;
  hasAiImage: boolean;
  thumbnailUrl: string | null;
  updatedAt: Date;
}

export interface ListProductsForAdminOptions {
  search?: string;
  categorySlug?: string;
  /** F-177: the admin product-list filter's actual category id — the
   * filter select's `<option>` values are category ids, but the table was
   * sending them under `categorySlug`, which `categorySlug` above filters
   * with `category: { slug }`; a cuid never equals a slug, so every
   * category choice silently matched zero products. Prefer this over
   * `categorySlug` when both are given. Expands to the category's own id
   * plus every descendant's, since several real categories (e.g. "School
   * Uniforms") hold no products directly — only their children do. */
  categoryId?: string;
  status?: ProductStatus;
  stockFilter?: "all" | "low" | "out";
  sort?: "name-asc" | "name-desc" | "price-asc" | "price-desc" | "updated-desc" | "stock-asc";
  page?: number;
  pageSize?: number;
}

const LOW_STOCK_THRESHOLD = 10;

/** F-177: `categoryId`'s own id plus every descendant category's id, so
 * filtering by a parent category (which typically holds no products of
 * its own — only its children do) still returns something. Walks the
 * whole `{id, parentId}` set in memory rather than a recursive query,
 * since the admin's category tree is small (dozens of rows). */
async function getSelfAndDescendantCategoryIds(categoryId: string): Promise<string[]> {
  const all = await db.category.findMany({ select: { id: true, parentId: true } });
  const childrenByParent = new Map<string, string[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c.id);
    childrenByParent.set(c.parentId, list);
  }
  const ids: string[] = [];
  const stack = [categoryId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    ids.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return ids;
}

export interface ListProductsForAdminResult {
  items: AdminProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listProductsForAdmin(options: ListProductsForAdminOptions = {}): Promise<ListProductsForAdminResult> {
  const where: Prisma.ProductWhereInput = {};
  if (options.status) where.status = options.status;
  if (options.categoryId) {
    where.categoryId = { in: await getSelfAndDescendantCategoryIds(options.categoryId) };
  } else if (options.categorySlug) {
    where.category = { slug: options.categorySlug };
  }
  if (options.search && options.search.trim()) {
    const term = options.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
      { tags: { has: term } },
    ];
  }

  const rows = await db.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, slug: true } },
      variants: { select: { stock: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, include: { media: { select: { url: true, source: true } } } },
      _count: { select: { images: true } },
    },
  });

  // AI badge needs to know if *any* image (not just the thumbnail) is AI-sourced.
  const aiImageProductIds = new Set(
    (
      await db.productImage.findMany({
        where: { productId: { in: rows.map((r) => r.id) }, media: { source: "AI" } },
        select: { productId: true },
      })
    ).map((r) => r.productId),
  );

  let items: AdminProductListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryId: row.category.id,
    categoryName: row.category.name,
    categorySlug: row.category.slug,
    price: Number(row.price),
    compareAtPrice: row.compareAtPrice ? Number(row.compareAtPrice) : null,
    totalStock: row.variants.reduce((sum, v) => sum + v.stock, 0),
    status: row.status,
    hasAiImage: aiImageProductIds.has(row.id),
    thumbnailUrl: row.images[0]?.media.url ?? null,
    updatedAt: row.updatedAt,
  }));

  if (options.stockFilter === "low") {
    items = items.filter((p) => p.totalStock > 0 && p.totalStock < LOW_STOCK_THRESHOLD);
  } else if (options.stockFilter === "out") {
    items = items.filter((p) => p.totalStock === 0);
  }

  const sort = options.sort ?? "updated-desc";
  items.sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "price-asc":
        return a.price - b.price;
      case "price-desc":
        return b.price - a.price;
      case "stock-asc":
        return a.totalStock - b.totalStock;
      case "updated-desc":
      default:
        return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
  });

  const total = items.length;
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { items: paged, total, page, pageSize, totalPages };
}

export interface AdminProductDetail {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  categoryId: string;
  status: ProductStatus;
  featured: boolean;
  isNew: boolean;
  price: number;
  compareAtPrice: number | null;
  gender: ProductGender;
  fabric: string | null;
  care: string | null;
  tags: string[];
  sizeChartId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  variants: {
    id: string;
    size: string;
    color: string;
    colorHex: string | null;
    sku: string;
    price: number | null;
    stock: number;
    active: boolean;
  }[];
  images: {
    id: string;
    mediaId: string;
    url: string;
    alt: string | null;
    color: string | null;
    sortOrder: number;
    source: string;
  }[];
  orderCount: number;
}

export async function getProductForAdmin(id: string): Promise<AdminProductDetail> {
  const row = await db.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: [{ size: "asc" }, { color: "asc" }] },
      images: { orderBy: { sortOrder: "asc" }, include: { media: true } },
    },
  });
  if (!row) throw new ProductNotFoundError(id);

  const orderCount = await countProductOrderItems(id);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    description: row.description,
    categoryId: row.categoryId,
    status: row.status,
    featured: row.featured,
    isNew: row.isNew,
    price: Number(row.price),
    compareAtPrice: row.compareAtPrice ? Number(row.compareAtPrice) : null,
    gender: row.gender,
    fabric: row.fabric,
    care: row.care,
    tags: row.tags,
    sizeChartId: row.sizeChartId,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    variants: row.variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      colorHex: v.colorHex,
      sku: v.sku,
      price: v.price ? Number(v.price) : null,
      stock: v.stock,
      active: v.active,
    })),
    images: row.images.map((img) => ({
      id: img.id,
      mediaId: img.mediaId,
      url: img.media.url,
      alt: img.alt,
      color: img.color,
      sortOrder: img.sortOrder,
      source: img.media.source,
    })),
    orderCount,
  };
}

/** Live slug-uniqueness check for the admin form's debounced field. */
export async function isSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
  const existing = await db.product.findUnique({ where: { slug: slugify(slug) }, select: { id: true } });
  return !existing || existing.id === excludeId;
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export interface BulkActionSkippedProduct {
  id: string;
  name: string;
  reason: string;
}

export interface BulkActionResult {
  action: BulkActionInput["action"];
  affected: number;
  /** Rows the action matched but deliberately left untouched — currently
   * only `adjust-price-pct`, when the computed price would violate the
   * `compareAtPrice > price` invariant (F6). The batch still succeeds for
   * every other row; callers should surface this list rather than drop it. */
  skipped?: BulkActionSkippedProduct[];
}

export async function performBulkAction(input: BulkActionInput, userId: string): Promise<BulkActionResult> {
  const products = await db.product.findMany({
    where: { id: { in: input.ids } },
    select: { id: true, slug: true, name: true, price: true, compareAtPrice: true },
  });
  if (products.length === 0) return { action: input.action, affected: 0 };

  const skipped: BulkActionSkippedProduct[] = [];
  // Products actually mutated by this call — defaults to every matched
  // product, narrowed below for adjust-price-pct's per-row skip.
  let changed = products;

  switch (input.action) {
    case "publish": {
      // F-028: the single-product publishProduct() rejects a product with
      // no active variant — the bulk path did the same blind updateMany
      // as every other bulk action and skipped that check entirely, so it
      // could put a whole batch of unbuyable products live at once. Same
      // skip-and-report shape as adjust-price-pct below, so the batch
      // still succeeds for every eligible product.
      const withActiveVariant = await db.productVariant.findMany({
        where: { productId: { in: input.ids }, active: true },
        select: { productId: true },
        distinct: ["productId"],
      });
      const publishableIds = new Set(withActiveVariant.map((v) => v.productId));
      for (const p of products) {
        if (!publishableIds.has(p.id)) {
          skipped.push({ id: p.id, name: p.name, reason: "no active variants" });
        }
      }
      const idsToPublish = products.filter((p) => publishableIds.has(p.id)).map((p) => p.id);
      if (idsToPublish.length > 0) {
        await db.product.updateMany({ where: { id: { in: idsToPublish } }, data: { status: "ACTIVE" } });
      }
      changed = products.filter((p) => publishableIds.has(p.id));
      break;
    }
    case "archive": {
      await db.product.updateMany({ where: { id: { in: input.ids } }, data: { status: "ARCHIVED" } });
      break;
    }
    case "move-category": {
      await getCategoryOrThrow(input.categoryId);
      await db.product.updateMany({ where: { id: { in: input.ids } }, data: { categoryId: input.categoryId } });
      break;
    }
    case "adjust-price-pct": {
      const updatable: { id: string; nextPrice: number }[] = [];
      for (const p of products) {
        const next = Math.max(0.01, Number(p.price) * (1 + input.percent / 100));
        const nextPrice = Math.round(next * 100) / 100;
        const compareAtPrice = p.compareAtPrice != null ? Number(p.compareAtPrice) : null;
        // Same invariant createProduct/updateProduct enforce as
        // InvalidCompareAtPriceError (compareAtPrice must stay strictly
        // greater than price) — a bulk "+20%" run must not be allowed to
        // silently break it and corrupt the storefront's `onSale` flag
        // (F6). Skip the offending row and report it instead of failing
        // — or worse, partially applying — the whole batch.
        if (compareAtPrice != null && compareAtPrice <= nextPrice) {
          skipped.push({ id: p.id, name: p.name, reason: "price would exceed compare-at price" });
          continue;
        }
        updatable.push({ id: p.id, nextPrice });
      }
      if (updatable.length > 0) {
        await db.$transaction(updatable.map((p) => db.product.update({ where: { id: p.id }, data: { price: p.nextPrice } })));
      }
      const skippedIds = new Set(skipped.map((s) => s.id));
      changed = products.filter((p) => !skippedIds.has(p.id));
      break;
    }
    case "set-stock": {
      await db.productVariant.updateMany({ where: { productId: { in: input.ids } }, data: { stock: input.stock } });
      break;
    }
  }

  await logAuditEvent({
    userId,
    action: "bulk-update",
    entity: "product",
    metadata: {
      bulkAction: input.action,
      count: changed.length,
      ids: input.ids,
      ...(skipped.length > 0 ? { skippedIds: skipped.map((s) => s.id) } : {}),
    },
  });

  safeRevalidate(PRODUCTS_CACHE_TAG);
  for (const p of changed) safeRevalidate(productCacheTag(p.slug));
  if (input.action === "move-category") safeRevalidate(CATEGORIES_CACHE_TAG);

  return { action: input.action, affected: changed.length, skipped: skipped.length > 0 ? skipped : undefined };
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export async function countDraftProductsAwaitingPublish(): Promise<number> {
  return db.product.count({ where: { status: "DRAFT" } });
}

export async function countLowStockVariants(threshold = LOW_STOCK_THRESHOLD): Promise<number> {
  return db.productVariant.count({ where: { active: true, stock: { lt: threshold } } });
}

/** Converts a raw Prisma `Product` row's Decimal fields to plain numbers
 * for a JSON API response — every admin route that returns a mutated
 * Product uses this so clients never have to parse a Decimal-shaped
 * string. */
export function serializeProductForResponse(product: Product) {
  return {
    ...product,
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
  };
}
