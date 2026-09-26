import { BlogPostEditor } from "@/components/admin/blog-post-editor";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

// F-062: this page had no permission check — any authenticated admin
// role could load (and, via "Save Article", attempt to edit) any blog
// post, including drafts, and a deactivated/demoted admin could keep
// reaching it through a soft navigation. See
// src/lib/auth/require-admin-page.ts.
export default async function EditBlogPostPage({ params }: PageProps) {
  await requireAdminPage("blog:manage");

  const { id } = await params;
  const post = await db.blogPostRecord.findUnique({ where: { id } });

  if (!post) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Article</h1>
        <p className="text-muted">{post.title}</p>
      </div>
      <BlogPostEditor
        initial={{
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          category: post.category,
          author: post.author,
          publishedAt: post.publishedAt.toISOString().slice(0, 10),
          readTime: post.readTime,
          image: post.image,
          content: JSON.parse(post.content) as string[],
          status: post.status,
        }}
      />
    </div>
  );
}
