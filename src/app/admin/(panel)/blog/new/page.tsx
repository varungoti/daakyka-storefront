import { BlogPostEditor } from "@/components/admin/blog-post-editor";

export default function NewBlogPostPage() {
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
