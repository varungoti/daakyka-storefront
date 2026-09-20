/**
 * Pure, DB-free helpers for product admin validation (Phase B1) — SKU
 * generation and variant-matrix building, plus the shared slug helper.
 *
 * Kept separate from src/lib/catalog/products.ts (the DB-backed service,
 * which imports `db` / Prisma) so these can be unit tested without a
 * database and imported from client components without pulling in
 * Prisma's Node-only dependencies — same rationale as category-validation.ts.
 */

export { slugify } from "@/lib/catalog/category-validation";

/** A short, uppercase code derived from a category name for use in SKUs,
 * e.g. "Scrub Sets" -> "SCRSET", "Kids Wear" -> "KIDWEA". Always 3-6
 * uppercase alphanumeric characters; falls back to "GEN" if nothing
 * alphanumeric survives. */
export function categoryCode(categoryName: string): string {
  const words = categoryName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "GEN";

  if (words.length === 1) {
    return words[0].slice(0, 6).padEnd(3, "X").slice(0, 6);
  }

  // Two-plus words: take 3 letters from the first, 3 from the second.
  const code = (words[0].slice(0, 3) + words[1].slice(0, 3)).slice(0, 6);
  return code.padEnd(3, "X");
}

/** A short, uppercase token for a size or color, safe for embedding in a
 * SKU (alphanumeric only, no spaces/hyphens). "2-3Y" -> "23Y",
 * "Sky Blue" -> "SKYBLUE". */
function skuToken(input: string): string {
  const token = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return token || "X";
}

/** Deterministic 4-character base36 checksum (FNV-1a 32-bit, no crypto
 * dependency needed for a non-cryptographic use case like this) of the
 * *full* input string. Two different inputs collide here only by chance
 * (1 in 36^4 ≈ 1.7M) — see `productNameToken`'s doc comment for why that,
 * combined with the DB's own `@unique` constraint on `ProductVariant.sku`,
 * is enough to call this "collision-safe" without a database round trip. */
function shortChecksum(value: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

/**
 * F-11 (docs/audit-2026-09-19/admin-ux.md): the short, human-readable
 * product-name portion of a SKU — e.g. `DK-FORHOS-UXAUDXXXX-XS-NAVY`
 * instead of the old `DK-FORHOS-UXAUDITCLASSICCOMFOR-XS-NAVY`, which
 * truncated the full slug to 20 characters and was awkward to read on a
 * pick list or read out over the phone/WhatsApp.
 *
 * Takes up to 2 significant words from the slug (3 letters each, so at
 * most 6 characters) for a human-readable hint, then appends a 4-character
 * deterministic checksum of the *full* slug so two products that abbreviate
 * to the same prefix (e.g. "Classic Comfort Scrub Top" and "Classic
 * Comfort Scrub Set") still very likely get different tokens — this is
 * what "collision-safe" means here in a pure, synchronous, DB-free helper
 * that can't itself check the database: the input slug is already globally
 * unique (`Product.slug` is `@unique`), so hashing the *whole* slug (not
 * just the truncated prefix) carries that uniqueness through with very
 * high probability, and `ProductVariant.sku`'s own `@unique` constraint
 * (enforced by Postgres at save time, surfaced today as a normal save
 * error) is the hard backstop on the rare chance two slugs ever did hash
 * to the same 4 characters — exactly the same backstop the old, longer
 * scheme also implicitly relied on rather than proving collision-freedom
 * itself.
 */
export function productNameToken(productSlug: string): string {
  const words = productSlug
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const prefix = words.slice(0, 2).map((word) => word.slice(0, 3)).join("");
  return `${prefix || "PRD"}${shortChecksum(productSlug)}`;
}

/** Builds the canonical variant SKU: DK-{CATCODE}-{NAMETOKEN}-{SIZE}-{COLOR}.
 *
 * IMPORTANT: this function is only ever called to mint a SKU for a *new*
 * variant row — the size×colour matrix generator, the admin's per-row
 * "regen" button, and product duplication (see generateVariantMatrix
 * below, product-variant-editor.tsx, and duplicateProduct in
 * src/lib/catalog/products.ts). Nothing in this codebase calls it against
 * an already-persisted variant as part of an ordinary save, so shortening
 * its output here changes what *newly generated* SKUs look like without
 * touching a single existing `ProductVariant.sku` value already in the
 * database (they're `@unique` and may already be on stock records) — see
 * that same doc comment for the collision-safety argument. */
export function generateSku(params: {
  categoryName: string;
  productSlug: string;
  size: string;
  color: string;
}): string {
  const catCode = categoryCode(params.categoryName);
  const nameToken = productNameToken(params.productSlug || "product");
  const sizeToken = skuToken(params.size);
  const colorToken = skuToken(params.color);
  return `DK-${catCode}-${nameToken}-${sizeToken}-${colorToken}`;
}

export interface VariantDraft {
  size: string;
  color: string;
  colorHex?: string | null;
  sku: string;
  stock: number;
  price?: number | null;
  active: boolean;
}

/** Cartesian product of sizes x colors, with an auto-generated SKU per
 * combination. Colors carry an optional hex for swatch rendering. Stock
 * defaults to 0 and active defaults to true — the caller (admin form) is
 * expected to edit these inline before saving. */
export function generateVariantMatrix(params: {
  categoryName: string;
  productSlug: string;
  sizes: string[];
  colors: { name: string; hex?: string }[];
}): VariantDraft[] {
  const sizes = dedupe(params.sizes);
  const colors = dedupeColors(params.colors);

  const variants: VariantDraft[] = [];
  for (const size of sizes) {
    for (const color of colors) {
      variants.push({
        size,
        color: color.name,
        colorHex: color.hex ?? null,
        sku: generateSku({ categoryName: params.categoryName, productSlug: params.productSlug, size, color: color.name }),
        stock: 0,
        price: null,
        active: true,
      });
    }
  }
  return variants;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function dedupeColors(colors: { name: string; hex?: string }[]): { name: string; hex?: string }[] {
  const seen = new Set<string>();
  const out: { name: string; hex?: string }[] = [];
  for (const color of colors) {
    const name = color.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, hex: color.hex });
  }
  return out;
}

export class DuplicateVariantKeyError extends Error {
  constructor(size: string, color: string) {
    super(`Duplicate variant: size "${size}" + color "${color}" already exists`);
    this.name = "DuplicateVariantKeyError";
  }
}

export class DuplicateVariantSkuError extends Error {
  constructor(sku: string) {
    super(`Duplicate SKU: "${sku}" is used by more than one variant`);
    this.name = "DuplicateVariantSkuError";
  }
}

/** Validates that every (size, color) pair is unique and every SKU is
 * unique within the given list of variants. Throws on the first
 * violation found. Used both client-side (form validation) and
 * server-side (replaceVariants) so the rules can never diverge. */
export function assertUniqueVariants(variants: { size: string; color: string; sku: string }[]): void {
  const keySeen = new Set<string>();
  const skuSeen = new Set<string>();
  for (const variant of variants) {
    const key = `${variant.size.trim().toLowerCase()}::${variant.color.trim().toLowerCase()}`;
    if (keySeen.has(key)) {
      throw new DuplicateVariantKeyError(variant.size, variant.color);
    }
    keySeen.add(key);

    const sku = variant.sku.trim().toUpperCase();
    if (skuSeen.has(sku)) {
      throw new DuplicateVariantSkuError(variant.sku);
    }
    skuSeen.add(sku);
  }
}
