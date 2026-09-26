import type { SiteImage } from "@/lib/media/get-site-image";
import type { CategoryTreeNode } from "@/lib/products";

/**
 * release-hardening audit F-364: the `category.<slug>` Site Images slot and
 * the category editor's own image picker (Category.image) used to be two
 * unrelated fields — an image uploaded through /admin/categories saved to
 * Category.image and showed up on the homepage tile, but never on that
 * category's own /category/[slug] page, which only ever read the slot.
 * Falls back to Category.image when the slot is empty, so whichever one an
 * admin actually filled in is the one shoppers see. Alt text falls back to
 * the category's own name — never a raw admin slot label (see
 * get-site-image.ts's doc comment on why a slot's alt can be admin-facing
 * text).
 *
 * Kept in its own module (not inlined in src/app/category/[slug]/page.tsx)
 * so it's a plain, DB-free unit test target — Node's test runner treats a
 * bracketed path segment like `[slug]` as a glob character class, so a
 * `*.test.ts` file cannot live inside that route folder.
 */
export function resolveCategoryHeadingImage(
  slotImage: SiteImage | null,
  category: Pick<CategoryTreeNode, "image" | "name">,
): SiteImage | null {
  if (slotImage) return slotImage;
  if (!category.image) return null;
  return { url: category.image.url, alt: category.image.alt ?? category.name };
}
