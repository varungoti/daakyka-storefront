/**
 * Pure, DB-free helpers and constants for category admin validation
 * (Phase B2).
 *
 * Kept separate from src/lib/catalog/categories.ts (the DB-backed service,
 * which imports `db` / Prisma and must never end up in a client bundle) so:
 *  - the slug and cycle-detection logic can be unit tested without a
 *    database — see category-validation.test.ts.
 *  - client components (e.g. category-form.tsx) can import the section
 *    enum/labels without pulling in Prisma's Node-only dependencies (this
 *    bit Next's client bundler in practice — see the Phase B2 build fix).
 */

export const categorySectionValues = ["HOSPITAL", "SCHOOL", "KIDS", "GENERAL"] as const;

export type CategorySectionValue = (typeof categorySectionValues)[number];

export const SECTION_LABELS: Record<CategorySectionValue, string> = {
  HOSPITAL: "For Hospitals",
  SCHOOL: "School Uniforms",
  KIDS: "Kids Wear",
  GENERAL: "General",
};

/** Lowercase, hyphenated slug from a free-text name. Never returns an
 * empty string — falls back to "category" if nothing alphanumeric survives. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
    .replace(/-+$/g, "");
  return slug || "category";
}

export interface CategoryLink {
  id: string;
  parentId: string | null;
}

/**
 * True when setting `categoryId`'s parent to `candidateParentId` would
 * create a cycle in the category tree — either directly (a category
 * can't be its own parent) or transitively (a category can't become a
 * descendant of one of its own descendants).
 *
 * `allCategories` should be every category's {id, parentId} in the
 * catalog (the current state, before the change under consideration).
 */
export function wouldCreateCategoryCycle(
  categoryId: string,
  candidateParentId: string,
  allCategories: CategoryLink[],
): boolean {
  if (categoryId === candidateParentId) return true;

  const byId = new Map(allCategories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let current = byId.get(candidateParentId) ?? null;

  while (current) {
    if (current.id === categoryId) return true;
    if (seen.has(current.id)) return true; // pre-existing bad data — treat as a cycle
    seen.add(current.id);
    current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
  }

  return false;
}
