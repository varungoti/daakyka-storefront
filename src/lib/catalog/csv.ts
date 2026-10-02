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
  // F-311: the per-product Legal Metrology / GST fields (the product form's
  // "Compliance" section). They sit after the variant columns — not beside
  // the other product-level ones — so every column that was already in the
  // template keeps its position: older CSVs, and anything that builds rows
  // positionally, still line up. Import reads by header name, so a file
  // without these columns is still valid (see ParsedImportRow).
  "country_of_origin",
  "net_quantity",
  "hsn_code",
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

// F-181: the same slug/hex rules and length limits the product admin form
// enforces (src/lib/catalog/products.ts's productInputSchema/variantSchema)
// — duplicated here rather than imported, because that module pulls in
// Prisma types this pure, DB-free module deliberately doesn't depend on
// (see the file comment). Kept in sync by the shared "dry run must catch
// what commit would reject" test coverage in csv.test.ts: a bad slug/hex
// used to sail through the dry run and only fail (or silently succeed with
// bad data) at commit.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_LENGTHS = {
  product_slug: 160,
  product_name: 200,
  short_description: 300,
  description: 8000,
  fabric: 200,
  care: 500,
  seo_title: 200,
  seo_description: 300,
  size: 40,
  color: 60,
  sku: 80,
  // F-311: the same ceilings productInputSchema applies to the form fields.
  country_of_origin: 100,
  net_quantity: 60,
  hsn_code: 20,
} as const;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 30;
const MAX_STOCK = 1_000_000;

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
  /** F-311: `undefined` when the file has no such column at all — an older
   * export or hand-made CSV — so the importer leaves the product's stored
   * value alone instead of wiping it; `null` when the column is there but
   * the cell is blank, which clears it (the same as blanking the form
   * field); otherwise the trimmed text. */
  countryOfOrigin?: string | null;
  netQuantity?: string | null;
  hsnCode?: string | null;
  /** F-191: false for a row that only carries product-level fields — no
   * size/color/sku at all (see the `size`/`color`/`sku`-all-empty case
   * below). `exportProductsCsv` writes one such row for a product with no
   * variants yet, rather than dropping the product out of the export
   * entirely; the importer must then write the product but skip writing a
   * variant for it, instead of trying to upsert one with an empty SKU. */
  hasVariant: boolean;
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

function parseBool(value: string | undefined, fallback: boolean): boolean {
  // F-181: a CSV that only has the REQUIRED_COLUMNS (no variant_active /
  // generate_images column at all) used to crash the dry run itself —
  // `toRecord` only sets a key for columns present in *this file's*
  // header, so `raw.variant_active` was `undefined`, and
  // `undefined.trim()` threw. Every admin who starts from the downloaded
  // template has every column, so this only bit a hand-written minimal CSV
  // — but a 500 on the dry run itself, before any row-level error could
  // even be shown, is worse than any single row's own validation error.
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

/** F-311: undefined = column absent from the file; null = present but blank. */
function optionalColumn(raw: Record<string, string>, column: string): string | null | undefined {
  if (!(column in raw)) return undefined;
  return raw[column]?.trim() || null;
}

/** Validates and parses every data row (rows[1:], rows[0] is the header).
 * `knownCategorySlugs` and `existingSkus` should reflect current DB state
 * for a meaningful dry run; pass empty sets to validate shape only.
 * `skuOwner` (F-181/F-191) maps an existing SKU to the product slug that
 * currently owns it — when given, a SKU that already belongs to *this same*
 * row's product only counts as an ordinary update (no warning, matching
 * what re-importing an unchanged export should look like), and one that
 * belongs to a different product still warns, since committing it would
 * throw ImportSkuConflictError. Omit it (or leave a SKU out of the map) to
 * fall back to the old, ownership-blind "already exists" warning.
 * Also detects duplicate SKUs, and duplicate (product_slug, size, color)
 * combinations, *within the file itself*. A row whose size/color/sku are
 * all blank (F-191 — see exportProductsCsv in product-import.ts) is a
 * product-only placeholder, not an incomplete variant row: those three
 * required columns are waived for it alone (`ParsedImportRow.hasVariant`
 * comes back `false`). Pure function — no I/O. */
export function validateImportRows(
  rows: string[][],
  options: { knownCategorySlugs: Set<string>; existingSkus: Set<string>; skuOwner?: Map<string, string> },
): RowValidationResult[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);
  const results: RowValidationResult[] = [];
  const skusInFile = new Map<string, number>(); // sku -> first row number seen
  const variantKeysInFile = new Map<string, number>(); // "slug::size::color" -> first row number seen

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const raw = toRecord(header, row);
    const errors: string[] = [];
    const warnings: string[] = [];

    // F-191: a row with no size/color/sku at all is `exportProductsCsv`'s
    // placeholder for a product that has no variants yet — not a normal
    // variant row missing its required fields. Every other required
    // column (product_slug, product_name, category_slug, price) is still
    // required either way.
    const isProductOnlyRow = !raw.size?.trim() && !raw.color?.trim() && !raw.sku?.trim();

    for (const col of REQUIRED_COLUMNS) {
      if (isProductOnlyRow && (col === "size" || col === "color" || col === "sku")) continue;
      if (!raw[col] || raw[col].trim() === "") {
        errors.push(`Missing required field "${col}"`);
      }
    }

    // F-181: the same length limits productInputSchema/variantSchema
    // enforce for these columns — a dry run that doesn't check them let a
    // commit either 500 (a Postgres column-length error) or silently
    // truncate/accept data the product form itself would have rejected.
    for (const [col, max] of Object.entries(MAX_LENGTHS) as [keyof typeof MAX_LENGTHS, number][]) {
      if (raw[col] && raw[col].length > max) {
        errors.push(`"${col}" must be ${max} characters or fewer`);
      }
    }

    if (raw.product_slug && !SLUG_PATTERN.test(raw.product_slug.trim())) {
      errors.push('product_slug must use lowercase letters, numbers, and hyphens only (e.g. "classic-scrub-top")');
    }

    if (raw.tags) {
      const tags = raw.tags.split("|").map((t) => t.trim()).filter(Boolean);
      if (tags.length > MAX_TAGS) {
        errors.push(`tags: at most ${MAX_TAGS} tags allowed (found ${tags.length})`);
      }
      const overLong = tags.find((t) => t.length > MAX_TAG_LENGTH);
      if (overLong) {
        errors.push(`tags: "${overLong}" is longer than ${MAX_TAG_LENGTH} characters`);
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

    if (raw.color_hex && raw.color_hex.trim() !== "" && !COLOR_HEX_PATTERN.test(raw.color_hex.trim())) {
      errors.push('color_hex must look like "#8FB8DE" (a # followed by 6 hex digits)');
    }

    const stock = raw.stock && raw.stock.trim() !== "" ? Number(raw.stock) : 0;
    if (raw.stock && (!Number.isInteger(stock) || stock < 0)) {
      errors.push("stock must be a non-negative integer");
    } else if (stock > MAX_STOCK) {
      errors.push(`stock must be ${MAX_STOCK.toLocaleString("en-IN")} or fewer`);
    }

    if (raw.sku) {
      const sku = raw.sku.trim().toUpperCase();
      const owner = options.skuOwner?.get(sku);
      // F-191: a SKU that already belongs to *this same* product is just
      // that variant being updated — the normal, expected shape of
      // re-importing an unchanged (or lightly edited) export. Only warn
      // when ownership is unknown (no skuOwner map given — the old,
      // ownership-blind behavior) or when it actually belongs to a
      // *different* product, which the commit would reject outright.
      if (options.skuOwner ? owner !== undefined && owner !== raw.product_slug.trim() : options.existingSkus.has(sku)) {
        warnings.push(`SKU "${raw.sku}" already exists — this row will update that variant`);
      }
      if (skusInFile.has(sku)) {
        errors.push(`Duplicate sku "${raw.sku}" also appears at row ${skusInFile.get(sku)}`);
      } else {
        skusInFile.set(sku, rowNumber);
      }
    }

    // F-181: two rows for the same product with the same (size, color) but
    // different SKUs used to pass the dry run clean and only fail at
    // commit, with an opaque 500 (Postgres' @@unique([productId, size,
    // color]) on ProductVariant) and no readable message anywhere.
    if (raw.product_slug && raw.size && raw.color) {
      const variantKey = `${raw.product_slug.trim().toLowerCase()}::${raw.size.trim().toLowerCase()}::${raw.color.trim().toLowerCase()}`;
      if (variantKeysInFile.has(variantKey)) {
        errors.push(`Duplicate size "${raw.size}" + color "${raw.color}" for this product also appears at row ${variantKeysInFile.get(variantKey)}`);
      } else {
        variantKeysInFile.set(variantKey, rowNumber);
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
            countryOfOrigin: optionalColumn(raw, "country_of_origin"),
            netQuantity: optionalColumn(raw, "net_quantity"),
            hsnCode: optionalColumn(raw, "hsn_code"),
            hasVariant: !isProductOnlyRow,
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
