/**
 * Pure CSV parsing and row-level validation for product import/export
 * (Phase B1) — one row per variant, grouped by product slug. No Prisma
 * import: category-slug and duplicate-SKU checks take pre-fetched sets as
 * input so this module (and its unit tests) never touch the database.
 * The DB-backed dry-run/commit wrapper lives in src/lib/catalog/product-import.ts.
 */

export const IMPORT_COLUMNS = [
  "product_slug",
  "product_name",
  "category_slug",
  "short_description",
  "description",
  "price",
  "compare_at_price",
  "fabric",
  "care",
  "gender",
  "tags",
  "seo_title",
  "seo_description",
  "size",
  "color",
  "color_hex",
  "sku",
  "stock",
  "variant_active",
  "generate_images",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: ImportColumn[] = [
  "product_slug",
  "product_name",
  "category_slug",
  "price",
  "size",
  "color",
  "sku",
];

const GENDER_VALUES = new Set(["MEN", "WOMEN", "UNISEX", "BOYS", "GIRLS", "KIDS"]);

// ---------------------------------------------------------------------------
// CSV parse / stringify
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 CSV parser: quoted fields, embedded commas/newlines,
 * and "" as an escaped quote. Returns rows of raw string cells (header
 * row included, at index 0). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Final field/row (files don't always end with a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function stringifyCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((row) => row.map((cell) => csvEscape(cell === null || cell === undefined ? "" : String(cell))).join(",")).join("\n");
}

// ---------------------------------------------------------------------------
// Row parsing / validation
// ---------------------------------------------------------------------------

export interface ParsedImportRow {
  productSlug: string;
  productName: string;
  categorySlug: string;
  shortDescription: string | null;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  fabric: string | null;
  care: string | null;
  gender: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  size: string;
  color: string;
  colorHex: string | null;
  sku: string;
  stock: number;
  variantActive: boolean;
  generateImages: boolean;
}

export interface RowValidationResult {
  rowNumber: number; // 1-based, matching the CSV line (header = row 1)
  status: "ok" | "warning" | "error";
  errors: string[];
  warnings: string[];
  data: ParsedImportRow | null;
  raw: Record<string, string>;
}

function toRecord(header: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  header.forEach((key, index) => {
    record[key.trim()] = (row[index] ?? "").trim();
  });
  return record;
}

function parseBool(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

/** Validates and parses every data row (rows[1:], rows[0] is the header).
 * `knownCategorySlugs` and `existingSkus` should reflect current DB state
 * for a meaningful dry run; pass empty sets to validate shape only.
 * Also detects duplicate SKUs *within the file itself*. Pure function —
 * no I/O. */
export function validateImportRows(
  rows: string[][],
  options: { knownCategorySlugs: Set<string>; existingSkus: Set<string> },
): RowValidationResult[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);
  const results: RowValidationResult[] = [];
  const skusInFile = new Map<string, number>(); // sku -> first row number seen

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const raw = toRecord(header, row);
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const col of REQUIRED_COLUMNS) {
      if (!raw[col] || raw[col].trim() === "") {
        errors.push(`Missing required field "${col}"`);
      }
    }

    const price = Number(raw.price);
    if (raw.price && (!Number.isFinite(price) || price <= 0)) {
      errors.push("price must be a number greater than 0");
    }

    let compareAtPrice: number | null = null;
    if (raw.compare_at_price && raw.compare_at_price.trim() !== "") {
      compareAtPrice = Number(raw.compare_at_price);
      if (!Number.isFinite(compareAtPrice)) {
        errors.push("compare_at_price must be a number");
      } else if (Number.isFinite(price) && compareAtPrice <= price) {
        errors.push("compare_at_price must be greater than price");
      }
    }

    if (raw.category_slug && !options.knownCategorySlugs.has(raw.category_slug.trim())) {
      errors.push(`Unknown category_slug "${raw.category_slug}"`);
    }

    if (raw.gender && !GENDER_VALUES.has(raw.gender.trim().toUpperCase())) {
      warnings.push(`Unrecognized gender "${raw.gender}" — will default to UNISEX`);
    }

    const stock = raw.stock && raw.stock.trim() !== "" ? Number(raw.stock) : 0;
    if (raw.stock && (!Number.isInteger(stock) || stock < 0)) {
      errors.push("stock must be a non-negative integer");
    }

    if (raw.sku) {
      const sku = raw.sku.trim().toUpperCase();
      if (options.existingSkus.has(sku)) {
        warnings.push(`SKU "${raw.sku}" already exists — this row will update that variant`);
      }
      if (skusInFile.has(sku)) {
        errors.push(`Duplicate sku "${raw.sku}" also appears at row ${skusInFile.get(sku)}`);
      } else {
        skusInFile.set(sku, rowNumber);
      }
    }

    const data: ParsedImportRow | null =
      errors.length === 0
        ? {
            productSlug: raw.product_slug.trim(),
            productName: raw.product_name.trim(),
            categorySlug: raw.category_slug.trim(),
            shortDescription: raw.short_description?.trim() || null,
            description: raw.description?.trim() || null,
            price,
            compareAtPrice,
            fabric: raw.fabric?.trim() || null,
            care: raw.care?.trim() || null,
            gender: GENDER_VALUES.has(raw.gender?.trim().toUpperCase()) ? raw.gender.trim().toUpperCase() : "UNISEX",
            tags: raw.tags ? raw.tags.split("|").map((t) => t.trim()).filter(Boolean) : [],
            seoTitle: raw.seo_title?.trim() || null,
            seoDescription: raw.seo_description?.trim() || null,
            size: raw.size.trim(),
            color: raw.color.trim(),
            colorHex: raw.color_hex?.trim() || null,
            sku: raw.sku.trim(),
            stock: Number.isFinite(stock) ? stock : 0,
            variantActive: parseBool(raw.variant_active, true),
            generateImages: parseBool(raw.generate_images, false),
          }
        : null;

    results.push({
      rowNumber,
      status: errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok",
      errors,
      warnings,
      data,
      raw,
    });
  });

  return results;
}

export interface GroupedImportProduct {
  productSlug: string;
  rows: ParsedImportRow[];
}

/** Groups successfully-parsed rows by product_slug, preserving first-seen
 * order. Rows with validation errors are excluded (callers should check
 * validateImportRows for errors before grouping). */
export function groupRowsByProduct(rows: ParsedImportRow[]): GroupedImportProduct[] {
  const order: string[] = [];
  const bySlug = new Map<string, ParsedImportRow[]>();
  for (const row of rows) {
    if (!bySlug.has(row.productSlug)) {
      bySlug.set(row.productSlug, []);
      order.push(row.productSlug);
    }
    bySlug.get(row.productSlug)!.push(row);
  }
  return order.map((slug) => ({ productSlug: slug, rows: bySlug.get(slug)! }));
}
