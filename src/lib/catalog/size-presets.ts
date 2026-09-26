/**
 * Preset size and colour lists for the product admin variant builder
 * (Phase B1). Pure data + a couple of small helpers — no Prisma import,
 * safe for client components.
 *
 * Colours match the exact names/hex values used by the draft launch
 * catalog (src/data/catalog/draft-catalog.ts) so the admin picker and the
 * seeded data stay visually consistent, plus a few common extras for
 * products outside the seed set.
 */

export type SizePresetKey = "adultScrubs" | "kidsAge" | "schoolChest" | "linens";

export const SIZE_PRESETS: Record<SizePresetKey, string[]> = {
  adultScrubs: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  kidsAge: ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y", "12-14Y"],
  // Numeric chest sizes, even numbers, as used by school-shirt/trouser charts.
  schoolChest: Array.from({ length: (44 - 20) / 2 + 1 }, (_, i) => String(20 + i * 2)),
  linens: ["Single", "Double", "King"],
};

export const SIZE_PRESET_LABELS: Record<SizePresetKey, string> = {
  adultScrubs: "Adult scrubs (XS–3XL)",
  kidsAge: "Kids by age (2-3Y–12-14Y)",
  schoolChest: "School by chest (20–44)",
  linens: "Linens (Single/Double/King)",
};

export const sizePresetKeys = Object.keys(SIZE_PRESETS) as SizePresetKey[];

export interface ColorPreset {
  name: string;
  hex: string;
}

/** Union of every colour name/hex used anywhere in the draft catalog
 * (hospital, school, kids, and linen palettes), de-duplicated, plus a
 * handful of common extras for products outside the seed set. */
export const COLOR_PRESETS: ColorPreset[] = [
  { name: "Navy", hex: "#1E3A5F" },
  { name: "Ceil Blue", hex: "#8FB8DE" },
  { name: "Wine", hex: "#722F37" },
  { name: "Hunter Green", hex: "#355E3B" },
  { name: "Black", hex: "#1F2937" },
  { name: "White", hex: "#F5F5F4" },
  { name: "Sky Blue", hex: "#AEE1F9" },
  { name: "Grey", hex: "#9CA3AF" },
  { name: "Maroon", hex: "#7B1E2E" },
  { name: "Red", hex: "#DC2626" },
  { name: "Yellow", hex: "#FACC15" },
  { name: "Mint", hex: "#6EE7B7" },
  { name: "Pink", hex: "#F9A8D4" },
  { name: "Pale Sky", hex: "#DCEEFB" },
  // Common extras not in the draft catalog but useful for new products.
  { name: "Charcoal", hex: "#374151" },
  { name: "Beige", hex: "#D9C8A9" },
  { name: "Royal Blue", hex: "#2563EB" },
  { name: "Orange", hex: "#F97316" },
];

const colorByName = new Map(COLOR_PRESETS.map((c) => [c.name.toLowerCase(), c]));

/** Looks up a preset colour's hex by name (case-insensitive); returns
 * undefined for a custom colour not in the preset list. */
export function findPresetColorHex(name: string): string | undefined {
  return colorByName.get(name.trim().toLowerCase())?.hex;
}

/** True when `name` is not one of the preset colours — the admin form
 * uses this to decide whether to show it under "custom" vs. the swatch
 * grid. */
export function isCustomColor(name: string): boolean {
  return !colorByName.has(name.trim().toLowerCase());
}

/** `COLOR_PRESETS`' own display order, by lowercased name — used as a
 * tie-break for colour ordering (release-hardening audit F-024) when a
 * colour isn't otherwise ordered by its product images. */
export function colorPresetIndex(name: string): number | undefined {
  const index = COLOR_PRESETS.findIndex((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  return index === -1 ? undefined : index;
}

// ---------------------------------------------------------------------------
// Size ordering (release-hardening audit F-024)
//
// Postgres has no defined row order for `ProductVariant`, so anything that
// reads `sizes`/`variants` straight off the DB (previously: every storefront
// read path) ends up in whatever order the index happens to return them —
// alphabetical in practice, hence "2XL L M S XL" instead of "S M L XL 2XL".
// `compareSizes` gives every size reader (the mapper in
// src/lib/products/index.ts, the admin grid) one shared, deterministic
// ordering instead. Pure and Prisma-free so it stays safe to import from
// client components, same as the rest of this file.
// ---------------------------------------------------------------------------

const SIZE_ORDER_GROUPS: SizePresetKey[] = ["adultScrubs", "kidsAge", "schoolChest", "linens"];

/** Case-insensitive, whitespace-trimmed, with the common "XXL"/"XXXL"
 * spellings folded onto this catalogue's own "2XL"/"3XL". */
function normalizeSizeToken(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (trimmed === "XXL") return "2XL";
  if (trimmed === "XXXL") return "3XL";
  return trimmed;
}

const SIZE_RANK: Map<string, number> = (() => {
  const rank = new Map<string, number>();
  let next = 0;
  for (const key of SIZE_ORDER_GROUPS) {
    for (const size of SIZE_PRESETS[key]) {
      const normalized = normalizeSizeToken(size);
      if (!rank.has(normalized)) rank.set(normalized, next++);
    }
  }
  return rank;
})();

/** The leading number in a value like "10-11Y" or "32" (for a numeric-aware
 * fallback outside the known presets); `null` when there isn't one. */
function leadingNumber(value: string): number | null {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Orders two size strings the way the merchant's size charts do — known
 * preset sizes first (XS…3XL, 2-3Y…12-14Y, the numeric school-chest range,
 * Single/Double/King), by their position in `SIZE_PRESETS`, then a
 * numeric-aware fallback for anything outside those presets (custom sizes,
 * a stray "Free Size"), rather than raw database/alphabetical order.
 * `Array.prototype.sort` is stable, so equal sizes keep their relative
 * input order.
 */
export function compareSizes(a: string, b: string): number {
  const normalizedA = normalizeSizeToken(a);
  const normalizedB = normalizeSizeToken(b);
  const rankA = SIZE_RANK.get(normalizedA);
  const rankB = SIZE_RANK.get(normalizedB);
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
  if (rankA !== undefined) return -1;
  if (rankB !== undefined) return 1;

  const numberA = leadingNumber(a);
  const numberB = leadingNumber(b);
  if (numberA !== null && numberB !== null && numberA !== numberB) return numberA - numberB;

  return a.localeCompare(b, undefined, { numeric: true });
}
