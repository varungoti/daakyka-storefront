import { revalidateTag, unstable_cache } from "next/cache";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG } from "@/lib/products";
import type { CategorySection, Prisma, SizeChart } from "@/generated/prisma/client";

/**
 * Phase B2: admin CRUD for `SizeChart` — a simple table (column headers +
 * rows of string cells), used by categories and products for the
 * storefront size guide.
 */

export const sizeChartUnitValues = ["IN", "CM"] as const;

export const sizeChartInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150),
    unit: z.enum(sizeChartUnitValues),
    columns: z.array(z.string().trim().min(1).max(60)).min(1, "At least one column is required").max(12),
    rows: z
      .array(z.array(z.string().trim().max(60)))
      .min(1, "At least one row is required")
      .max(60),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    value.rows.forEach((row, index) => {
      if (row.length !== value.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Row ${index + 1} must have exactly ${value.columns.length} cell(s), one per column`,
          path: ["rows", index],
        });
      }
    });
  });

export type SizeChartInput = z.infer<typeof sizeChartInputSchema>;

export class SizeChartNotFoundError extends Error {
  constructor(id: string) {
    super(`Size chart ${id} not found`);
    this.name = "SizeChartNotFoundError";
  }
}

export class SizeChartInUseError extends Error {
  constructor(
    public readonly categoryCount: number,
    public readonly productCount: number,
  ) {
    super(
      `Unassign this size chart from ${[
        categoryCount > 0 ? `${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}` : null,
        productCount > 0 ? `${productCount} product${productCount === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(" and ")} before deleting it`,
    );
    this.name = "SizeChartInUseError";
  }
}

function safeRevalidate(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // No static generation store in this context — nothing to revalidate.
  }
}

function revalidateCatalog() {
  safeRevalidate(CATEGORIES_CACHE_TAG);
  safeRevalidate(PRODUCTS_CACHE_TAG);
}

export interface AdminSizeChart {
  id: string;
  name: string;
  unit: (typeof sizeChartUnitValues)[number];
  columns: string[];
  rows: string[][];
  notes: string | null;
  categoryCount: number;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ADMIN_SIZE_CHART_INCLUDE = {
  _count: { select: { categories: true, products: true } },
} satisfies Prisma.SizeChartInclude;

type AdminSizeChartRow = Prisma.SizeChartGetPayload<{ include: typeof ADMIN_SIZE_CHART_INCLUDE }>;

function toAdminSizeChart(row: AdminSizeChartRow): AdminSizeChart {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    columns: Array.isArray(row.columns) ? (row.columns as string[]) : [],
    rows: Array.isArray(row.rows) ? (row.rows as string[][]) : [],
    notes: row.notes,
    categoryCount: row._count.categories,
    productCount: row._count.products,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSizeChartsForAdmin(): Promise<AdminSizeChart[]> {
  const rows = await db.sizeChart.findMany({
    include: ADMIN_SIZE_CHART_INCLUDE,
    orderBy: { name: "asc" },
  });
  return rows.map(toAdminSizeChart);
}

export async function getSizeChartForAdmin(id: string): Promise<AdminSizeChart> {
  const row = await db.sizeChart.findUnique({ where: { id }, include: ADMIN_SIZE_CHART_INCLUDE });
  if (!row) throw new SizeChartNotFoundError(id);
  return toAdminSizeChart(row);
}

export async function createSizeChart(input: SizeChartInput, userId: string): Promise<SizeChart> {
  const created = await db.sizeChart.create({
    data: {
      name: input.name.trim(),
      unit: input.unit,
      columns: input.columns as Prisma.InputJsonValue,
      rows: input.rows as Prisma.InputJsonValue,
      notes: input.notes ?? null,
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "size_chart",
    entityId: created.id,
    metadata: { name: created.name, unit: created.unit },
  });

  revalidateCatalog();
  return created;
}

export async function updateSizeChart(
  id: string,
  input: SizeChartInput,
  userId: string,
): Promise<SizeChart> {
  const existing = await db.sizeChart.findUnique({ where: { id } });
  if (!existing) throw new SizeChartNotFoundError(id);

  const updated = await db.sizeChart.update({
    where: { id },
    data: {
      name: input.name.trim(),
      unit: input.unit,
      columns: input.columns as Prisma.InputJsonValue,
      rows: input.rows as Prisma.InputJsonValue,
      notes: input.notes ?? null,
    },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "size_chart",
    entityId: updated.id,
    metadata: { name: updated.name },
  });

  revalidateCatalog();
  return updated;
}

export async function deleteSizeChart(id: string, userId: string): Promise<void> {
  const existing = await db.sizeChart.findUnique({
    where: { id },
    include: { _count: { select: { categories: true, products: true } } },
  });
  if (!existing) throw new SizeChartNotFoundError(id);

  if (existing._count.categories > 0 || existing._count.products > 0) {
    throw new SizeChartInUseError(existing._count.categories, existing._count.products);
  }

  await db.sizeChart.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "size_chart",
    entityId: id,
    metadata: { name: existing.name },
  });

  revalidateCatalog();
}

// ---------------------------------------------------------------------------
// Public storefront read (Phase C3: /size-guide)
// ---------------------------------------------------------------------------

export interface SizeChartForDisplay {
  id: string;
  name: string;
  unit: (typeof sizeChartUnitValues)[number];
  columns: string[];
  rows: (string | number)[][];
  notes: string | null;
}

export interface SizeChartSectionGroup {
  section: CategorySection;
  charts: SizeChartForDisplay[];
}

/** A SizeChart's `rows` is stored as JSON and, in practice, comes from two
 * different writers with two different shapes: the Phase E1 seed writes
 * an array of `{ column: value }` objects (see
 * src/data/catalog/draft-catalog.ts), while the admin CRUD's zod schema
 * (sizeChartInputSchema above) expects an array of arrays already in
 * column order. Normalize both into arrays-in-column-order so the
 * storefront table can render either without crashing. */
function normalizeRows(columns: string[], rawRows: unknown): (string | number)[][] {
  if (!Array.isArray(rawRows)) return [];
  return rawRows.map((row) => {
    if (Array.isArray(row)) return row as (string | number)[];
    if (row && typeof row === "object") {
      return columns.map((column) => {
        const value = (row as Record<string, unknown>)[column];
        return typeof value === "number" || typeof value === "string" ? value : "";
      });
    }
    return [];
  });
}

function toSizeChartForDisplay(chart: SizeChart): SizeChartForDisplay {
  const columns = Array.isArray(chart.columns) ? (chart.columns as string[]) : [];
  return {
    id: chart.id,
    name: chart.name,
    unit: chart.unit,
    columns,
    rows: normalizeRows(columns, chart.rows),
    notes: chart.notes,
  };
}

async function fetchSizeChartsForDisplay(): Promise<SizeChartSectionGroup[]> {
  const categories = await db.category.findMany({
    where: { active: true, sizeChartId: { not: null } },
    select: { section: true, sizeChart: true },
  });

  const bySection = new Map<CategorySection, Map<string, SizeChartForDisplay>>();
  for (const category of categories) {
    if (!category.sizeChart) continue;
    const chart = toSizeChartForDisplay(category.sizeChart);
    if (!bySection.has(category.section)) bySection.set(category.section, new Map());
    bySection.get(category.section)!.set(chart.id, chart);
  }

  const sectionOrder: CategorySection[] = ["HOSPITAL", "SCHOOL", "KIDS", "GENERAL"];
  return sectionOrder
    .filter((section) => bySection.has(section))
    .map((section) => ({
      section,
      charts: [...bySection.get(section)!.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

const cachedSizeChartsForDisplay = unstable_cache(fetchSizeChartsForDisplay, ["size-charts-display"], {
  tags: [CATEGORIES_CACHE_TAG],
});

/** Every active category's size chart, grouped by CategorySection, for
 * the public /size-guide page. Falls back to an empty array (rather than
 * throwing) when the DB is unavailable or unstable_cache has no request
 * scope to attach to — the page renders its static fit-tips content
 * either way. */
export async function getSizeChartsForDisplay(): Promise<SizeChartSectionGroup[]> {
  try {
    return await cachedSizeChartsForDisplay();
  } catch {
    try {
      return await fetchSizeChartsForDisplay();
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Public storefront read (Phase C5: product detail "Size guide" modal)
// ---------------------------------------------------------------------------

async function fetchSizeChartForProduct(productId: string): Promise<SizeChartForDisplay | null> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      sizeChart: true,
      category: { select: { sizeChart: true } },
    },
  });
  if (!product) return null;

  // Product-level override wins when set (Product.sizeChartId); otherwise
  // fall back to the category's default chart (Category.sizeChartId).
  const chart = product.sizeChart ?? product.category.sizeChart;
  return chart ? toSizeChartForDisplay(chart) : null;
}

/** The size chart to show for a single product's "Size guide" modal:
 * the product's own override if `Product.sizeChartId` is set, else its
 * category's default (`Category.sizeChartId`), else `null` when neither
 * has one configured. Falls back to `null` (not a throw) on any DB
 * error, same rationale as getSizeChartsForDisplay above. */
export async function getSizeChartForProduct(productId: string): Promise<SizeChartForDisplay | null> {
  const cached = unstable_cache(
    () => fetchSizeChartForProduct(productId),
    ["size-chart-for-product", productId],
    { tags: [CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG] },
  );

  try {
    return await cached();
  } catch {
    try {
      return await fetchSizeChartForProduct(productId);
    } catch {
      return null;
    }
  }
}
