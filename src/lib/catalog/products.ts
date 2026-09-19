import { revalidateTag } from "next/cache";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG, productCacheTag } from "@/lib/products";
import type { Prisma, Product, ProductGender, ProductStatus } from "@/generated/prisma/client";
import { slugify } from "@/lib/catalog/category-validation";
import { assertUniqueVariants, generateSku } from "@/lib/catalog/product-validation";

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
  description: optionalTrimmed(5000),
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

  const slug = input.slug ? slugify(input.slug) : await generateUniqueSlug(input.name);
  if (input.slug) await assertSlugAvailable(slug);

  if (input.sizeChartId) await assertSizeChartExists(input.sizeChartId);

  const created = await db.product.create({
    data: {
      name: input.name.trim(),
      slug,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
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

export async function updateProduct(id: string, input: ProductUpdateInput, userId: string): Promise<Product> {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new ProductNotFoundError(id);

  const nextPrice = input.price ?? Number(existing.price);
  const nextCompareAt = input.compareAtPrice !== undefined ? input.compareAtPrice : existing.compareAtPrice ? Number(existing.compareAtPrice) : null;
  if (nextCompareAt != null && nextCompareAt <= nextPrice) {
    throw new InvalidCompareAtPriceError();
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
  if (input.description !== undefined) data.description = input.description;
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

export async function replaceVariants(productId: string, variants: VariantInput[], userId: string): Promise<void> {
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

  await db.$transaction([
    db.productVariant.deleteMany({ where: { productId } }),
    db.productVariant.createMany({
      data: variants.map((v) => ({
        productId,
        size: v.size.trim(),
        color: v.color.trim(),
        colorHex: v.colorHex ?? null,
        sku: v.sku.trim(),
        price: v.price ?? null,
        stock: v.stock,
        active: v.active ?? true,
      })),
    }),
  ]);

  await logAuditEvent({
    userId,
    action: "update",
    entity: "product_variants",
    entityId: productId,
    metadata: { count: variants.length },
  });

  revalidateProduct(product.slug);
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
  status?: ProductStatus;
  stockFilter?: "all" | "low" | "out";
  sort?: "name-asc" | "name-desc" | "price-asc" | "price-desc" | "updated-desc" | "stock-asc";
  page?: number;
  pageSize?: number;
}

const LOW_STOCK_THRESHOLD = 10;

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
  if (options.categorySlug) where.category = { slug: options.categorySlug };
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
      await db.product.updateMany({ where: { id: { in: input.ids } }, data: { status: "ACTIVE" } });
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
