import { BlogPostEditor } from "@/components/admin/blog-post-editor";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

// F-062: this page had no permission check at all — any authenticated
// admin role could open the editor, and a deactivated/demoted admin with
// a tab already open could keep reaching it via a soft (RSC) navigation,
// since the (panel) layout's DB-backed session check does not re-run on
// those. See src/lib/auth/require-admin-page.ts.
export default async function NewBlogPostPage() {
  await requireAdminPage("blog:manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Article</h1>
        <p className="text-muted">Create a journal post for the storefront.</p>
      </div>
      <BlogPostEditor />
    </div>
  );
}
