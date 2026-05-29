import { BlogPostEditor } from "@/components/admin/blog-post-editor";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditBlogPostPage({ params }: PageProps) {
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
