import { db } from "@/lib/db";
import { blogPosts as seedBlogPosts } from "@/data/blog";
import type { BlogPost } from "@/data/blog";

function mapRecord(record: {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  publishedAt: Date;
  readTime: string;
  image: string;
  content: string;
}): BlogPost {
  return {
    slug: record.slug,
    title: record.title,
    excerpt: record.excerpt,
    category: record.category,
    author: record.author,
    publishedAt: record.publishedAt.toISOString().slice(0, 10),
    readTime: record.readTime,
    image: record.image,
    content: JSON.parse(record.content) as string[],
  };
}

export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  try {
    const records = await db.blogPostRecord.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
    if (records.length === 0) return seedBlogPosts;
    return records.map(mapRecord);
  } catch {
    return seedBlogPosts;
  }
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  try {
    const record = await db.blogPostRecord.findFirst({
      where: { slug, status: "PUBLISHED" },
    });
    if (!record) {
      return seedBlogPosts.find((post) => post.slug === slug) ?? null;
    }
    return mapRecord(record);
  } catch {
    return seedBlogPosts.find((post) => post.slug === slug) ?? null;
  }
}

export async function getAllBlogPostsForAdmin() {
  return db.blogPostRecord.findMany({
    orderBy: { updatedAt: "desc" },
  });
}
