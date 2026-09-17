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
