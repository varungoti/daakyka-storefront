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
