import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  draftCategories,
  draftProducts,
  draftSizeCharts,
  type DraftCategory,
} from "../src/data/catalog/draft-catalog";
import { createPrismaClient } from "../src/lib/create-prisma-client";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";

/**
 * Phase E1 draft launch catalog seed.
 *
 * Idempotent and create-only throughout: every category, size chart,
 * product and variant is created once (by slug/name/sku) and never
 * overwritten on a re-run, so this is safe to run repeatedly (including
 * on every deploy, like prisma/seed.ts) without clobbering anything an
 * admin has since edited from /admin.
 *
 * All seeded products are DRAFT by default. Pass --publish (or
 * `{ publish: true }` when calling seedCatalog directly) to also flip
 * every seeded product to ACTIVE — only meant for local dev so the
 * storefront has something to render. See `npm run db:seed:catalog`.
 *
 * `seedCatalog` takes its Prisma client as a parameter (rather than
 * creating its own) so integration tests can call it against the same
 * connection they already use, and to keep this module import-safe: just
 * importing it (e.g. from a test) must never open a second connection or
 * run the seed as a side effect. Only the CLI entrypoint at the bottom
 * does that, and only when this file is executed directly.
 */

export interface SeedCatalogSummary {
  categoriesSeeded: number;
  sizeChartsSeeded: number;
  productsCreated: number;
  productsExisting: number;
  variantsCreated: number;
  publishedCount?: number;
}

async function seedSizeCharts(db: PrismaClient): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();

  for (const chart of draftSizeCharts) {
    const existing = await db.sizeChart.findFirst({ where: { name: chart.name } });
    if (existing) {
      idByKey.set(chart.key, existing.id);
      continue;
    }
    const created = await db.sizeChart.create({
      data: {
        name: chart.name,
        unit: chart.unit,
        columns: chart.columns as Prisma.InputJsonValue,
        rows: chart.rows as Prisma.InputJsonValue,
        notes: chart.notes,
      },
    });
    idByKey.set(chart.key, created.id);
  }

  return idByKey;
}

async function seedCategories(
  db: PrismaClient,
  sizeChartIdByKey: Map<string, string>,
): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();
  const remaining = new Map<string, DraftCategory>(draftCategories.map((c) => [c.slug, c]));

  // Categories can be nested (for-hospitals -> hospital-linens ->
  // bedsheets), so a single pass isn't enough to always have the
  // parent's id ready. Keep making passes over whatever's left until
  // nothing more can be created — this handles any depth without
  // requiring the source array to be topologically sorted by hand.
  while (remaining.size > 0) {
    let progressed = false;

    for (const [slug, category] of remaining) {
      const parentId = category.parentSlug ? idBySlug.get(category.parentSlug) : null;
      if (category.parentSlug && parentId === undefined) {
        continue; // parent not created yet — try again next pass
      }

      const sizeChartId = category.sizeChartKey
        ? sizeChartIdByKey.get(category.sizeChartKey)
        : undefined;

      const created = await db.category.upsert({
        where: { slug },
        update: {},
        create: {
          slug: category.slug,
          name: category.name,
          description: category.description,
          section: category.section,
          parentId: parentId ?? null,
          sortOrder: category.sortOrder,
          showInMenu: category.showInMenu,
          sizeChartId: sizeChartId ?? null,
        },
      });

      idBySlug.set(slug, created.id);
      remaining.delete(slug);
      progressed = true;
    }

    if (!progressed) {
      throw new Error(
        `Could not resolve parent categories for: ${[...remaining.keys()].join(", ")} ` +
          "(check for a missing or misspelled parentSlug in draft-catalog.ts).",
      );
    }
  }

  return idBySlug;
}

async function seedProducts(
  db: PrismaClient,
  categoryIdBySlug: Map<string, string>,
  sizeChartIdByKey: Map<string, string>,
): Promise<{ created: number; existing: number; variantsCreated: number }> {
  let created = 0;
  let existing = 0;
  let variantsCreated = 0;

  for (const product of draftProducts) {
    const categoryId = categoryIdBySlug.get(product.categorySlug);
    if (!categoryId) {
      throw new Error(
        `Product "${product.slug}" references unknown category "${product.categorySlug}"`,
      );
    }
    const sizeChartId = product.sizeChartKey
      ? sizeChartIdByKey.get(product.sizeChartKey)
      : undefined;

    const existingProduct = await db.product.findUnique({ where: { slug: product.slug } });

    await db.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: {
        slug: product.slug,
        name: product.name,
        shortDescription: product.shortDescription,
        description: product.description,
        categoryId,
        status: "DRAFT",
        featured: product.featured,
        isNew: product.isNew,
        price: product.price,
        compareAtPrice: product.compareAtPrice ?? null,
        gender: product.gender,
        fabric: product.fabric,
        care: product.care,
        tags: product.tags,
        sizeChartId: sizeChartId ?? null,
      },
    });

    if (existingProduct) {
      existing += 1;
    } else {
      created += 1;
    }

    if (product.variants.length === 0) continue;

    const dbProduct = await db.product.findUniqueOrThrow({
      where: { slug: product.slug },
      select: { id: true },
    });

    for (const variant of product.variants) {
      const existingVariant = await db.productVariant.findUnique({
        where: { sku: variant.sku },
      });
      if (existingVariant) continue;

      await db.productVariant.create({
        data: {
          productId: dbProduct.id,
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          colorHex: variant.colorHex,
          stock: variant.stock,
        },
      });
      variantsCreated += 1;
    }
  }

  return { created, existing, variantsCreated };
}

async function publishSeededProducts(db: PrismaClient): Promise<number> {
  const slugs = draftProducts.map((p) => p.slug);
  const result = await db.product.updateMany({
    where: { slug: { in: slugs } },
    data: { status: "ACTIVE" },
  });
  return result.count;
}

export async function seedCatalog(
  db: PrismaClient,
  options: { publish?: boolean } = {},
): Promise<SeedCatalogSummary> {
  const sizeChartIdByKey = await seedSizeCharts(db);
  const categoryIdBySlug = await seedCategories(db, sizeChartIdByKey);
  const { created, existing, variantsCreated } = await seedProducts(
    db,
    categoryIdBySlug,
    sizeChartIdByKey,
  );

  const summary: SeedCatalogSummary = {
    categoriesSeeded: categoryIdBySlug.size,
    sizeChartsSeeded: sizeChartIdByKey.size,
    productsCreated: created,
    productsExisting: existing,
    variantsCreated,
  };

  if (options.publish) {
    summary.publishedCount = await publishSeededProducts(db);
  }

  return summary;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const prisma = createPrismaClient();
  const publish = process.argv.includes("--publish");

  seedCatalog(prisma, { publish })
    .then((summary) => {
      console.log(`Seeded ${summary.sizeChartsSeeded} size charts.`);
      console.log(`Seeded ${summary.categoriesSeeded} categories.`);
      console.log(
        `Products: ${summary.productsCreated} created, ` +
          `${summary.productsExisting} already existed (untouched), ` +
          `${summary.variantsCreated} new variants created.`,
      );
      if (publish) {
        console.log(`--publish: set ${summary.publishedCount} seeded products to ACTIVE.`);
      } else {
        console.log(
          "Products remain DRAFT. Re-run with --publish to make them visible on the storefront.",
        );
      }
      console.log("Catalog seed complete.");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
