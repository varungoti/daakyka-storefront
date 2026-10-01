import { db } from "@/lib/db";
import type { ProductGender } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { ADMIN_REVALIDATE_PROFILE } from "@/lib/cache/admin-revalidate";
import { PRODUCTS_CACHE_TAG, CATEGORIES_CACHE_TAG } from "@/lib/products";
import { revalidateTag } from "next/cache";
import {
  IMPORT_COLUMNS,
  groupRowsByProduct,
  parseCsv,
  stringifyCsv,
  validateImportRows,
  type ParsedImportRow,
  type RowValidationResult,
} from "@/lib/catalog/csv";
import { generateImage, isImageGenerationConfigured } from "@/lib/ai/image-generation";
import { prepareDescriptionForStorage } from "@/lib/catalog/description-html";

/**
 * Phase B1: CSV import/export for products. Row-level parsing/validation
 * is pure (src/lib/catalog/csv.ts, unit tested); this module adds the
 * DB-backed dry-run (fetches known category slugs + existing SKUs) and
 * the transactional commit (create-or-update by product slug, idempotent
 * on re-run with the same slugs).
 */

// F-032: immediate ({ expire: 0 }) — see src/lib/cache/admin-revalidate.ts.
function safeRevalidate(tag: string) {
  try {
    revalidateTag(tag, ADMIN_REVALIDATE_PROFILE);
  } catch {
    // No static generation store in this context.
  }
}

/**
 * Builds the SKU-ownership lookup used by validateImportRows' "SKU already
 * exists" warning and commitProductImport's cross-product SKU-move guard.
 *
 * Pulled out as a pure function (no Prisma types, no I/O) so the one
 * defensive line that matters — a variant whose owning product can't be
 * resolved is excluded rather than dereferenced — is directly and
 * deterministically testable. See fetchValidationContext below for why
 * that case is real, not hypothetical.
 */
export function buildSkuOwnership(
  variants: { sku: string; productId: string }[],
  productSlugById: Map<string, string>,
): { existingSkus: Set<string>; skuOwner: Map<string, string> } {
  return {
    existingSkus: new Set(variants.map((v) => v.sku.toUpperCase())),
    skuOwner: new Map(
      variants
        .map((v) => [v.sku.toUpperCase(), productSlugById.get(v.productId)] as const)
        .filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  };
}

async function fetchValidationContext() {
  const [categories, variants] = await Promise.all([
    db.category.findMany({ select: { slug: true } }),
    db.productVariant.findMany({ select: { sku: true, productId: true } }),
  ]);

  // Bug 3 (flaky "export round-trip" null-deref): this used to fetch
  // `product: { select: { slug: true } } }` as a nested relation directly
  // on the query above. Prisma's pg driver adapter resolves a to-one
  // relation like that as a *second*, separate `SELECT ... WHERE id IN
  // (...)` query rather than a single atomic SQL join (confirmed via
  // query logging — relationLoadStrategy effectively falls back to
  // "query" for @prisma/adapter-pg). ProductVariant.product is a required
  // relation in the schema (onDelete: Cascade), but a concurrent delete of
  // the owning product landing between those two queries still made
  // Prisma resolve it to `null` at runtime — `v.product.slug` then threw.
  // Roughly 1 admin CSV import/export run in 3 hit this under the
  // integration suite's concurrent test files, each creating/deleting
  // their own products against the same DB. Looking products up
  // ourselves through an explicit id→slug map (and simply excluding a
  // variant that doesn't resolve — see buildSkuOwnership) removes the
  // unguarded access instead of relying on the relation's shape.
  const productIds = Array.from(new Set(variants.map((v) => v.productId)));
  const products =
    productIds.length > 0 ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, slug: true } }) : [];
  const productSlugById = new Map(products.map((p) => [p.id, p.slug]));

  const { existingSkus, skuOwner } = buildSkuOwnership(variants, productSlugById);

  return {
    knownCategorySlugs: new Set(categories.map((c) => c.slug)),
    existingSkus,
    skuOwner,
  };
}

export interface DryRunResult {
  rows: RowValidationResult[];
  summary: { total: number; ok: number; warning: number; error: number; products: number };
}

export async function dryRunProductImport(csvText: string): Promise<DryRunResult> {
  const parsed = parseCsv(csvText);
  const context = await fetchValidationContext();
  const rows = validateImportRows(parsed, context);

  const products = new Set(rows.filter((r) => r.data).map((r) => r.data!.productSlug));

  return {
    rows,
    summary: {
      total: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      warning: rows.filter((r) => r.status === "warning").length,
      error: rows.filter((r) => r.status === "error").length,
      products: products.size,
    },
  };
}

export class ImportValidationError extends Error {
  constructor(public readonly rows: RowValidationResult[]) {
    super("The import file has validation errors — fix them and re-run the dry run before committing");
    this.name = "ImportValidationError";
  }
}

export class ImportSkuConflictError extends Error {
  constructor(sku: string, ownerSlug: string, thisSlug: string) {
    super(`SKU "${sku}" already belongs to product "${ownerSlug}" — can't assign it to "${thisSlug}"`);
    this.name = "ImportSkuConflictError";
  }
}

export interface CommitResult {
  productsCreated: number;
  productsUpdated: number;
  variantsWritten: number;
  imagesQueued: number;
}

export async function commitProductImport(
  csvText: string,
  userId: string,
  options: { generateImages?: boolean } = {},
): Promise<CommitResult> {
  const parsed = parseCsv(csvText);
  const context = await fetchValidationContext();
  const rows = validateImportRows(parsed, context);

  if (rows.some((r) => r.status === "error")) {
    throw new ImportValidationError(rows);
  }

  const validRows = rows.map((r) => r.data!).filter(Boolean) as ParsedImportRow[];
  const groups = groupRowsByProduct(validRows);

  // Cross-product SKU-move guard: a SKU already owned by a *different*
  // product slug can't be silently reassigned.
  for (const group of groups) {
    for (const row of group.rows) {
      const owner = context.skuOwner.get(row.sku.toUpperCase());
      if (owner && owner !== group.productSlug) {
        throw new ImportSkuConflictError(row.sku, owner, group.productSlug);
      }
    }
  }

  const categoriesBySlug = new Map(
    (await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c]),
  );

  let productsCreated = 0;
  let productsUpdated = 0;
  let variantsWritten = 0;
  const productsNeedingImages: { id: string; name: string; categorySlug: string; gender: string | null }[] = [];

  await db.$transaction(async (tx) => {
    for (const group of groups) {
      const first = group.rows[0];
      const category = categoriesBySlug.get(first.categorySlug);
      if (!category) continue; // validated already; defensive only

      const existing = await tx.product.findUnique({ where: { slug: group.productSlug } });

      const tags = Array.from(new Set(group.rows.flatMap((r) => r.tags)));

      const productData = {
        name: first.productName,
        categoryId: category.id,
        shortDescription: first.shortDescription,
        // Defense in depth: a CSV cell is always plain text in practice,
        // but this guarantees a description can never reach the DB
        // without going through the same allowlist a rich-text editor
        // save would (see description-html.ts's file comment).
        description: prepareDescriptionForStorage(first.description),
        price: first.price,
        compareAtPrice: first.compareAtPrice,
        fabric: first.fabric,
        care: first.care,
        gender: (first.gender ?? "UNISEX") as ProductGender,
        tags,
        seoTitle: first.seoTitle,
        seoDescription: first.seoDescription,
      };

      let productId: string;
      if (existing) {
        // F-180/F-191: this used to also write `sizeChartId:
        // category.sizeChartId` on every update, which pinned the
        // *category's current* chart onto the product every time it was
        // re-imported — silently discarding a custom per-product chart set
        // through the admin form (there's no size_chart column in the CSV
        // to preserve it through). There's nothing to update here: leaving
        // sizeChartId out of `data` entirely leaves whatever the product
        // already had (an override, or NULL/inherit) untouched.
        await tx.product.update({ where: { id: existing.id }, data: productData });
        productId = existing.id;
        productsUpdated += 1;
      } else {
        const created = await tx.product.create({
          // F-180: NULL (inherit the category's chart, live) for a brand
          // new product — matching createProduct's own default (see
          // products.ts) — never the category's chart id pinned at import
          // time.
          data: { ...productData, sizeChartId: null, slug: group.productSlug, status: "DRAFT", createdById: userId },
        });
        productId = created.id;
        productsCreated += 1;
      }

      for (const row of group.rows) {
        // F-191: a product-only placeholder row (exportProductsCsv's row
        // for a product with no variants — see its own comment) carries no
        // size/color/sku to write. Skipping it here is what makes such a
        // row safe to re-import at all, rather than upserting a variant
        // with an empty SKU.
        if (!row.hasVariant) continue;
        const sku = row.sku.trim();
        await tx.productVariant.upsert({
          where: { sku },
          update: {
            productId,
            size: row.size,
            color: row.color,
            colorHex: row.colorHex,
            stock: row.stock,
            active: row.variantActive,
          },
          create: {
            productId,
            size: row.size,
            color: row.color,
            colorHex: row.colorHex,
            sku,
            stock: row.stock,
            active: row.variantActive,
          },
        });
        variantsWritten += 1;
      }

      const imageCount = await tx.productImage.count({ where: { productId } });
      if (imageCount === 0 && group.rows.some((r) => r.generateImages)) {
        productsNeedingImages.push({ id: productId, name: first.productName, categorySlug: first.categorySlug, gender: first.gender });
      }
    }
  });

  await logAuditEvent({
    userId,
    action: "import",
    entity: "product",
    metadata: { productsCreated, productsUpdated, variantsWritten },
  });

  safeRevalidate(PRODUCTS_CACHE_TAG);
  safeRevalidate(CATEGORIES_CACHE_TAG);

  let imagesQueued = 0;
  if (options.generateImages !== false && isImageGenerationConfigured()) {
    // Don't block the commit on image generation — best effort, a couple
    // of products only, swallow individual failures.
    const toGenerate = productsNeedingImages.slice(0, 3);
    for (const product of toGenerate) {
      try {
        const asset = await generateImage({
          preset: "product",
          fields: { name: product.name, category: product.categorySlug, gender: product.gender ?? undefined },
          aspect: "square",
          usage: "PRODUCT",
          alt: product.name,
          createdById: userId,
        });
        await db.productImage.create({ data: { productId: product.id, mediaId: asset.id, sortOrder: 0 } });
        imagesQueued += 1;
      } catch {
        // Best effort — image generation failures never fail the import.
      }
    }
    if (imagesQueued > 0) safeRevalidate(PRODUCTS_CACHE_TAG);
  }

  return { productsCreated, productsUpdated, variantsWritten, imagesQueued };
}

// ---------------------------------------------------------------------------
// Template / export
// ---------------------------------------------------------------------------

export function buildImportTemplateCsv(): string {
  const header = [...IMPORT_COLUMNS];
  const example = [
    "sample-scrub-set",
    "Sample Scrub Set",
    "hospital-scrubs",
    "Comfortable unisex scrub set",
    "A full description of the sample scrub set.",
    "899",
    "1099",
    "Cotton-poly blend",
    "Machine wash cold",
    "UNISEX",
    "scrubs|hospital",
    "Sample Scrub Set | Daakyka",
    "Comfortable unisex scrub set for hospital staff",
    "M",
    "Ceil Blue",
    "#8FB8DE",
    "DK-SCRUBS-SAMPLE-M-CEILBLUE",
    "20",
    "yes",
    "no",
  ];
  return stringifyCsv([header, example]);
}

export async function exportProductsCsv(filter: { categorySlug?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED" } = {}): Promise<string> {
  const products = await db.product.findMany({
    where: {
      category: filter.categorySlug ? { slug: filter.categorySlug } : undefined,
      status: filter.status,
    },
    include: { category: { select: { slug: true } }, variants: { orderBy: [{ size: "asc" }, { color: "asc" }] } },
    orderBy: { slug: "asc" },
  });

  const rows: (string | number)[][] = [[...IMPORT_COLUMNS]];

  for (const product of products) {
    const productCells = [
      product.slug,
      product.name,
      product.category.slug,
      product.shortDescription ?? "",
      product.description ?? "",
      Number(product.price),
      product.compareAtPrice ? Number(product.compareAtPrice) : "",
      product.fabric ?? "",
      product.care ?? "",
      product.gender,
      product.tags.join("|"),
      product.seoTitle ?? "",
      product.seoDescription ?? "",
    ];

    if (product.variants.length === 0) {
      // F-191: was skipped entirely (the old loop only ever ran for
      // `product.variants`), so a product with no variants yet — a draft
      // still being set up — silently dropped out of "Export all
      // products". A row with size/color/sku all blank is recognized by
      // validateImportRows (csv.ts) as a product-only placeholder: the
      // required-field check is waived for just those three columns, and
      // commitProductImport writes the product's own fields but skips
      // writing a variant for it (ParsedImportRow.hasVariant), rather than
      // upserting one with an empty SKU.
      rows.push([...productCells, "", "", "", "", "", "", ""]);
      continue;
    }

    for (const variant of product.variants) {
      rows.push([
        ...productCells,
        variant.size,
        variant.color,
        variant.colorHex ?? "",
        variant.sku,
        variant.stock,
        variant.active ? "yes" : "no",
        "no",
      ]);
    }
  }

  return stringifyCsv(rows);
}
