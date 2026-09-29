import { revalidateTag } from "next/cache";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG, productCacheTag } from "@/lib/products";
import { Prisma } from "@/generated/prisma/client";
import type { Product, ProductGender, ProductStatus } from "@/generated/prisma/client";
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
  // release-hardening F-311/F-195: India Legal Metrology / GST columns
  // added in wave 1 (see prisma/schema.prisma) — per-product overrides of
  // the store-wide defaults rendered on the PDP/invoice. All optional: a
  // product with none of these set still falls back to the store default
  // (country of origin) or simply omits the line (net quantity, HSN).
  countryOfOrigin: optionalTrimmed(100),
  netQuantity: optionalTrimmed(60),
  hsnCode: optionalTrimmed(20),
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
    // F-185: was "Only draft products..." — an ARCHIVED product with no
    // orders is now deletable too (see deleteProduct below), so the
    // message needs to say so, or the 409 an admin sees after archiving is
    // misleading about what it would actually take to delete it.
    super("Only draft or archived products with no orders can be deleted");
    this.name = "ProductNotDraftError";
  }
}

/** F-185: thrown by unarchiveProduct when the product isn't currently
 * ARCHIVED — mirrors ProductNotDraftError's role for delete. */
export class ProductNotArchivedError extends Error {
  constructor() {
    super("Only archived products can be unarchived");
    this.name = "ProductNotArchivedError";
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
      countryOfOrigin: input.countryOfOrigin ?? null,
      netQuantity: input.netQuantity ?? null,
      hsnCode: input.hsnCode ?? null,
      tags: input.tags ?? [],
      // F-180: was `input.sizeChartId ?? category.sizeChartId ?? null` —
      // choosing "None" in the form (input.sizeChartId undefined/null) used
      // to permanently pin the category's *current* chart onto the
      // product, rather than actually inheriting it. size-charts.ts's own
      // resolver already falls back to `product.category.sizeChart` when
      // `product.sizeChartId` is NULL (see resolveSizeChartForProduct), so
      // (see fetchSizeChartForProduct's `product.sizeChart ??
      // product.category.sizeChart`). NULL here *is* "inherit, and keep
      // inheriting as the category's chart changes" — pinning at create
      // time was never needed for that to work, and broke it.
      sizeChartId: input.sizeChartId ?? null,
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
  if (input.countryOfOrigin !== undefined) data.countryOfOrigin = input.countryOfOrigin;
  if (input.netQuantity !== undefined) data.netQuantity = input.netQuantity;
  if (input.hsnCode !== undefined) data.hsnCode = input.hsnCode;
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

  // F-185: an ARCHIVED product with no orders used to be undeletable from
  // the UI without first Publish -> Unpublish -> Delete (putting it back
  // live on the storefront along the way, just to take it down again) —
  // deleting it directly, the same as a DRAFT, is safe for the same
  // reason a draft is: nothing on the storefront links to it.
  if (existing.status !== "DRAFT" && existing.status !== "ARCHIVED") {
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

/** F-185: returns an ARCHIVED product to DRAFT. Deliberately a separate
 * action from unpublishProduct (both land on DRAFT, but unpublishProduct
 * requires `products:publish` — taking a *live* product down is a publish
 * decision). Unarchiving a product that was never live is ordinary catalog
 * upkeep, so the /publish route gates this the same as archive itself:
 * `products:manage`. Only valid from ARCHIVED, so a stale double-click (or
 * a race with another admin's action) gets a clear 409 instead of quietly
 * flipping a DRAFT or ACTIVE product to DRAFT. */
export async function unarchiveProduct(id: string, userId: string): Promise<Product> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);
  if (existing.status !== "ARCHIVED") throw new ProductNotArchivedError();

  const updated = await db.product.update({ where: { id }, data: { status: "DRAFT" } });

  await logAuditEvent({ userId, action: "unarchive", entity: "product", entityId: id, metadata: { slug: updated.slug } });
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

// F-194 fix: all three helpers below used to look the image up by imageId
// alone, so a request to /products/{A}/images/{imageOfB} silently edited or
// removed product B's image (and revalidated B) while the URL claimed to
// be acting on A. They now require the caller's productId to match the
// image's actual productId, mirroring reorderProductImages below (which
// was already scoped this way).
export async function removeProductImage(productId: string, imageId: string, userId: string): Promise<void> {
  const image = await db.productImage.findFirst({ where: { id: imageId, productId }, include: { product: { select: { slug: true } } } });
  if (!image) throw new ProductImageNotFoundError(imageId);

  await db.productImage.delete({ where: { id: imageId } });

  await logAuditEvent({ userId, action: "delete", entity: "product_image", entityId: imageId, metadata: { productId: image.productId } });
  revalidateProduct(image.product.slug);
}

export async function setImageColor(productId: string, imageId: string, color: string | null, userId: string) {
  const image = await db.productImage.findFirst({ where: { id: imageId, productId }, include: { product: { select: { slug: true } } } });
  if (!image) throw new ProductImageNotFoundError(imageId);

  const updated = await db.productImage.update({ where: { id: imageId }, data: { color }, include: { media: true } });

  await logAuditEvent({ userId, action: "update", entity: "product_image", entityId: imageId, metadata: { color } });
  revalidateProduct(image.product.slug);
  return updated;
}

export async function updateImageAlt(productId: string, imageId: string, alt: string | null, userId: string) {
  const image = await db.productImage.findFirst({ where: { id: imageId, productId }, include: { product: { select: { slug: true } } } });
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
  // F-194: the image isn't on this product at all (a mismatched
  // productId/imageId pair) — a real not-found, distinct from the
  // legitimate no-op below when the image is already first/last.
  if (index === -1) throw new ProductImageNotFoundError(imageId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) return false;

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

/**
 * F-341 fix (release-hardening admin-table-mobile-and-pagination-perf):
 * this used to load *every* product matching status/category into JS
 * (no `take`), then filter by stock, sort and slice a page out of that
 * in-memory array — the same anti-pattern F-224 fixed for orders. On every
 * admin keystroke that meant transferring and re-serializing the whole
 * catalogue just to show 24 rows. `total_stock` (the sum of a product's
 * variant stock, used by both the low/out-of-stock filter and the
 * stock-asc sort) can't be expressed as a plain Prisma `where`/`orderBy`
 * without Prisma's relation-aggregate `orderBy`, which this generated
 * client doesn't support for a `_sum` — so filtering, sorting, counting
 * and paging all happen in one raw query against a per-product stock
 * subquery, and only the resulting page's ids are ever pulled back from
 * the DB in full via `db.product.findMany` below.
 */
function buildProductListWhereSql(options: {
  status?: ProductStatus;
  categoryIds?: string[];
  categorySlug?: string;
  search?: string;
  stockFilter?: "all" | "low" | "out";
}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (options.status) conditions.push(Prisma.sql`p.status = ${options.status}::"ProductStatus"`);
  if (options.categoryIds) {
    conditions.push(Prisma.sql`p."categoryId" IN (${Prisma.join(options.categoryIds)})`);
  } else if (options.categorySlug) {
    conditions.push(Prisma.sql`c.slug = ${options.categorySlug}`);
  }
  if (options.search) {
    const like = `%${options.search}%`;
    conditions.push(Prisma.sql`(
      p.name ILIKE ${like}
      OR p.slug ILIKE ${like}
      OR ${options.search} = ANY(p.tags)
      OR EXISTS (
        SELECT 1 FROM "ProductVariant" pv WHERE pv."productId" = p.id AND pv.sku ILIKE ${like}
      )
    )`);
  }
  if (options.stockFilter === "low") {
    conditions.push(Prisma.sql`COALESCE(s.total_stock, 0) > 0 AND COALESCE(s.total_stock, 0) < ${LOW_STOCK_THRESHOLD}`);
  } else if (options.stockFilter === "out") {
    conditions.push(Prisma.sql`COALESCE(s.total_stock, 0) = 0`);
  }
  return conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

function buildProductOrderBySql(sort: NonNullable<ListProductsForAdminOptions["sort"]>): Prisma.Sql {
  switch (sort) {
    case "name-asc":
      return Prisma.sql`p.name ASC, p.id ASC`;
    case "name-desc":
      return Prisma.sql`p.name DESC, p.id DESC`;
    case "price-asc":
      return Prisma.sql`p.price ASC, p.id ASC`;
    case "price-desc":
      return Prisma.sql`p.price DESC, p.id DESC`;
    case "stock-asc":
      return Prisma.sql`COALESCE(s.total_stock, 0) ASC, p.id ASC`;
    case "updated-desc":
    default:
      return Prisma.sql`p."updatedAt" DESC, p.id DESC`;
  }
}

// Shared by both the count and the page-of-ids query below — `s` (each
// product's summed variant stock) is what the stock filter/sort and the
// WHERE clause's `COALESCE(s.total_stock, ...)` references.
const PRODUCT_LIST_FROM_SQL = Prisma.sql`
  FROM "Product" p
  JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN (
    SELECT "productId", COALESCE(SUM(stock), 0) AS total_stock
    FROM "ProductVariant"
    GROUP BY "productId"
  ) s ON s."productId" = p.id
`;

export async function listProductsForAdmin(options: ListProductsForAdminOptions = {}): Promise<ListProductsForAdminResult> {
  const categoryIds = options.categoryId ? await getSelfAndDescendantCategoryIds(options.categoryId) : undefined;
  const search = options.search && options.search.trim() ? options.search.trim() : undefined;
  const whereSql = buildProductListWhereSql({
    status: options.status,
    categoryIds,
    categorySlug: options.categorySlug,
    search,
    stockFilter: options.stockFilter,
  });

  const countRows = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    ${PRODUCT_LIST_FROM_SQL}
    ${whereSql}
  `);
  const total = countRows[0]?.count ?? 0;

  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);
  const skip = (page - 1) * pageSize;

  const sort = options.sort ?? "updated-desc";
  const pageRows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id
    ${PRODUCT_LIST_FROM_SQL}
    ${whereSql}
    ORDER BY ${buildProductOrderBySql(sort)}
    LIMIT ${pageSize} OFFSET ${skip}
  `);
  const ids = pageRows.map((r) => r.id);
  if (ids.length === 0) {
    return { items: [], total, page, pageSize, totalPages };
  }

  const rows = await db.product.findMany({
    where: { id: { in: ids } },
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
        where: { productId: { in: ids }, media: { source: "AI" } },
        select: { productId: true },
      })
    ).map((r) => r.productId),
  );

  // Rehydrated via a plain `id IN (...)` findMany, which doesn't preserve
  // the raw query's own ORDER BY — re-applied here against just this one
  // page's rows (at most `pageSize`, never the whole table).
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const items: AdminProductListItem[] = ids
    .map((id) => rowById.get(id))
    .filter((row): row is (typeof rows)[number] => row !== undefined)
    .map((row) => ({
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

  return { items, total, page, pageSize, totalPages };
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
  countryOfOrigin: string | null;
  netQuantity: string | null;
  hsnCode: string | null;
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
    countryOfOrigin: row.countryOfOrigin,
    netQuantity: row.netQuantity,
    hsnCode: row.hsnCode,
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
      // F-340: this used to read every product's price in JS (the
      // `products` findMany above), compute `nextPrice` in JS, then write
      // it back with plain `db.product.update` calls — a classic
      // read-modify-write race. Two overlapping bulk "+10%" runs on the
      // same product both read the *same* starting price before either
      // wrote back, so only one +10% ever actually landed (both calls
      // still reported success), and an overlapping "+10%"/"-10%" pair
      // left only whichever one wrote last. Mirrors the single atomic
      // `UPDATE ... RETURNING` pattern in src/lib/auth/lockout.ts's
      // recordFailedLogin (see that file's comment): the whole
      // read-modify-write happens inside the `UPDATE` itself, computed
      // from the row's own *current* `price` column, so Postgres
      // serializes concurrent updates to the same row under its normal
      // row-level locking instead of letting them interleave — the second
      // run's `UPDATE` blocks on the row lock until the first commits,
      // then computes its own percentage against the first run's
      // *already-adjusted* price, so two overlapping +10% runs correctly
      // compound to +21%.
      //
      // F-182: also adjusts every variant price *override*
      // (`ProductVariant.price`) by the same factor — previously only
      // `Product.price` was touched, so checkout (which prefers
      // `variant.price` over the product's own — see
      // src/lib/orders/create-order.ts) silently charged an overridden
      // variant's untouched old price through a "sale", or left it below
      // a raised base price. Both the base price and every override round
      // to whole rupees (`GREATEST(1, ROUND(...))`, no decimal places) —
      // this business prices everything in whole INR, not paise.
      //
      // The compare-at invariant createProduct/updateProduct enforce as
      // InvalidCompareAtPriceError (compareAtPrice must stay strictly
      // greater than every price a shopper can actually be charged) is
      // checked, in the same statement, against both the new base price
      // and every new override price: a product is skipped — base price
      // *and* every override left untouched — if either would violate it,
      // rather than the base price going on sale while one variant's
      // override doesn't (or ends up priced *below* the sale).
      const percent = input.percent;
      const updatedIds = await db.$transaction(async (tx) => {
        const updatedProducts = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "Product" AS p
          SET price = GREATEST(1, ROUND(p.price * (1 + ${percent}::numeric / 100))),
              "updatedAt" = now()
          WHERE p.id = ANY(${input.ids}::text[])
            AND (
              p."compareAtPrice" IS NULL
              OR p."compareAtPrice" > GREATEST(1, ROUND(p.price * (1 + ${percent}::numeric / 100)))
            )
            AND NOT EXISTS (
              SELECT 1 FROM "ProductVariant" AS v
              WHERE v."productId" = p.id
                AND v.price IS NOT NULL
                AND p."compareAtPrice" IS NOT NULL
                AND p."compareAtPrice" <= GREATEST(1, ROUND(v.price * (1 + ${percent}::numeric / 100)))
            )
          RETURNING p.id
        `;
        const ids = updatedProducts.map((p) => p.id);
        if (ids.length > 0) {
          // Scoped to exactly the products whose base price just passed
          // the invariant above — a skipped product's overrides must stay
          // untouched too.
          await tx.$queryRaw`
            UPDATE "ProductVariant" AS v
            SET price = GREATEST(1, ROUND(v.price * (1 + ${percent}::numeric / 100))),
                "updatedAt" = now()
            WHERE v."productId" = ANY(${ids}::text[])
              AND v.price IS NOT NULL
          `;
        }
        return ids;
      });

      const updatedIdSet = new Set(updatedIds);
      for (const p of products) {
        if (!updatedIdSet.has(p.id)) {
          skipped.push({ id: p.id, name: p.name, reason: "price would exceed compare-at price" });
        }
      }
      changed = products.filter((p) => updatedIdSet.has(p.id));
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
