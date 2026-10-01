import { BlogPostEditor } from "@/components/admin/blog-post-editor";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { parseBlogContent } from "@/lib/blog/content";
import { db } from "@/lib/db";
import { formatIstDateOnly } from "@/lib/format/datetime";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Edit Article" };

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
          // F-331: was `.toISOString().slice(0, 10)`, which reads the UTC
          // calendar date and re-showed the previous day for any post
          // published 00:00-05:29 IST.
          publishedAt: formatIstDateOnly(post.publishedAt),
          readTime: post.readTime,
          image: post.image,
          // F-213: JSON.parse threw on a Hermes-approved draft whose content was
          // plain text, so opening it hit the admin error boundary.
          content: parseBlogContent(post.content),
          status: post.status,
        }}
      />
    </div>
  );
}
