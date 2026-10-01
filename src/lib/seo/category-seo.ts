import type { Metadata } from "next";
import { db } from "@/lib/db";

/**
 * release-hardening F-098: the admin category form
 * (src/components/admin/category-form.tsx) saves an "SEO title"/"SEO
 * description" per category, but the shared catalog read path
 * (`fetchActiveCategoriesFlat`/`CategoryTreeNode` in src/lib/products/
 * index.ts) never selects those two columns, so nothing the storefront
 * renders — /category/[slug], /for-hospitals, /school-uniforms,
 * /kids-wear — could ever read them. This is a small, independent lookup
 * (rather than widening the shared category-tree read, which many other
 * call sites rely on) so those pages' `generateMetadata` can prefer the
 * admin override. Uncached and metadata-only: it's called once per
 * request from a route already doing its own uncached `getCategoryBySlug`
 * call for the same reason (see that function's callers).
 */
export async function getCategorySeoOverride(
  slug: string,
): Promise<{ seoTitle: string | null; seoDescription: string | null } | null> {
  try {
    return await db.category.findFirst({
      where: { slug, active: true },
      select: { seoTitle: true, seoDescription: true },
    });
  } catch {
    return null;
  }
}

/**
 * The `<title>`/meta description for a category page: the admin's SEO
 * title/description when they entered one, else the page's own fallback.
 * Shared by /category/[slug] and the three section landing pages so they
 * can't drift apart on the precedence.
 *
 * The SEO title is `absolute` — it bypasses the root layout's
 * "%s | DAAKYKA Apparels" template, same as the PDP's admin SEO title
 * (products/[handle]/page.tsx): an admin-authored title may already carry
 * the brand name and must show exactly as typed. The fallback title keeps
 * the template.
 */
export function resolveCategoryMetadata(
  fallback: { title: string; description: string },
  override: { seoTitle: string | null; seoDescription: string | null } | null,
): { title: NonNullable<Metadata["title"]>; description: string } {
  const seoTitle = override?.seoTitle?.trim();
  const seoDescription = override?.seoDescription?.trim();
  return {
    title: seoTitle ? { absolute: seoTitle } : fallback.title,
    description: seoDescription || fallback.description,
  };
}
