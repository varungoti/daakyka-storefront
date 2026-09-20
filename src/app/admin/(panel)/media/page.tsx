import { redirect } from "next/navigation";
import { IMAGE_MANIFEST, blogPostImageSlot, categoryImageSlot } from "@/data/media/image-manifest";
import type { SiteImageSlotRow } from "@/components/admin/site-images-grid";
import { SiteImagesGrid } from "@/components/admin/site-images-grid";
import { MediaLibraryEntryPoint } from "@/components/admin/media-library-entry-point";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getAllBlogPostsForAdmin } from "@/lib/blog";
import { getSiteImages } from "@/lib/media/get-site-image";
import { getCategoryTree, type CategoryTreeNode } from "@/lib/products";

function flattenCategories(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

/**
 * Phase E2 admin "Site Images" tab: every slot declared in the image
 * manifest (src/data/media/image-manifest.ts) — homepage, content pages,
 * size guide — plus the dynamic `category.{slug}` slot for every active
 * category and `blog.post.{slug}` for every blog post, each with its
 * current image (or "Not generated yet") and Generate/Replace actions.
 *
 * This renders correctly with zero images configured (the current state
 * of this environment): every card shows the neutral placeholder and a
 * "Not generated yet" badge, and both actions surface the existing 503
 * "not configured" messages from the underlying admin API routes rather
 * than failing silently.
 */
export default async function AdminMediaPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "media:manage")) {
    redirect("/admin/dashboard");
  }

  const [categoryTree, blogPosts] = await Promise.all([getCategoryTree(), getAllBlogPostsForAdmin()]);
  const categories = flattenCategories(categoryTree);

  const entries = [
    ...IMAGE_MANIFEST.map((entry) => ({ ...entry, group: groupForSlot(entry.slot) })),
    ...categories.map((category) => ({ ...categoryImageSlot(category), group: "Categories" })),
    ...blogPosts.map((post) => ({ ...blogPostImageSlot(post), group: "Blog Covers" })),
  ];

  const currentImages = await getSiteImages(entries.map((entry) => entry.slot));

  const rows: SiteImageSlotRow[] = entries.map((entry) => ({
    slot: entry.slot,
    label: entry.label,
    group: entry.group,
    usage: entry.usage,
    preset: entry.preset,
    aspect: entry.aspect,
    fields: entry.fields,
    current: currentImages[entry.slot] ?? null,
    uploadOnly: entry.uploadOnly,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Media Library</h1>
          <p className="text-muted">
            Site images — hero banners, category tiles, and page heroes — below. Uploads and AI generation for
            product images still happen from the product editor, which can now also pick from everything already
            uploaded instead of always starting fresh.
          </p>
        </div>
        {/* F-07 (docs/audit-2026-09-19/admin-ux.md): a real "browse
            everything I've uploaded" view, searchable/filterable by usage,
            source, and date — see media-library-browser.tsx, the same
            component the product gallery's "Browse library" button opens. */}
        <MediaLibraryEntryPoint />
      </div>
      <SiteImagesGrid rows={rows} />
    </div>
  );
}

function groupForSlot(slot: string): string {
  if (slot.startsWith("home.")) return "Homepage";
  if (slot.startsWith("size-guide.")) return "Size Guide";
  if (slot.startsWith("about.")) return "About Page";
  return "Content Pages";
}
