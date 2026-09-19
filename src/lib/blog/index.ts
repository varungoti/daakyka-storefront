import { revalidateTag, unstable_cache } from "next/cache";
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

async function readPublishedBlogPostsFromDb(): Promise<BlogPost[]> {
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

async function readBlogPostBySlugFromDb(slug: string): Promise<BlogPost | null> {
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

/**
 * Same gap and same fix as src/lib/homepage/index.ts (see its
 * HOMEPAGE_CACHE_TAG comment for the full doc citation): /blog and
 * /blog/[slug] are statically prerendered — the latter via
 * generateStaticParams() in src/app/blog/[slug]/page.tsx — so an admin
 * create/update/delete/publish needs an explicit revalidateTag() or it
 * would never reach the live site short of a full redeploy. The write
 * paths live in src/app/api/admin/blog/route.ts and
 * src/app/api/admin/blog/[id]/route.ts (not in this file), so they import
 * revalidateBlogCache() below directly.
 */
export const BLOG_CACHE_TAG = "blog";

const cachedGetPublishedBlogPosts = unstable_cache(
  readPublishedBlogPostsFromDb,
  ["published-blog-posts"],
  { tags: [BLOG_CACHE_TAG] },
);

const cachedGetBlogPostBySlug = unstable_cache(
  readBlogPostBySlugFromDb,
  ["blog-post-by-slug"],
  { tags: [BLOG_CACHE_TAG] },
);

export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  try {
    return await cachedGetPublishedBlogPosts();
  } catch {
    // unstable_cache needs Next's incremental cache / request store, which
    // isn't present outside an actual Next server (unit tests, scripts,
    // etc). Fall back to an uncached read rather than throwing.
    return readPublishedBlogPostsFromDb();
  }
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  try {
    return await cachedGetBlogPostBySlug(slug);
  } catch {
    return readBlogPostBySlugFromDb(slug);
  }
}

export async function getAllBlogPostsForAdmin() {
  return db.blogPostRecord.findMany({
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Invalidates the cached blog reads. Split out as its own export (rather
 * than inlining revalidateTag at each API route call site) so it's
 * independently testable — see src/lib/homepage/index.ts's
 * revalidateHomepageCache() for why: next/cache's exports can't be
 * mocked from a test (non-configurable accessor properties, and this
 * project's tests run as real ESM anyway), so tests inject a fake
 * `revalidate` here instead of spying on the real one.
 */
export function revalidateBlogCache(
  revalidate: (tag: string, profile: string) => void = revalidateTag,
): void {
  try {
    revalidate(BLOG_CACHE_TAG, "max");
  } catch {
    // No static generation store in this context (unit/integration tests,
    // one-off scripts) — nothing to revalidate.
  }
}
