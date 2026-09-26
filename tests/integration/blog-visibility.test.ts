import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getBlogPostBySlug, getPublishedBlogPosts } from "@/lib/blog";

/**
 * F-331: a PUBLISHED post with a future `publishedAt` used to go live
 * immediately (readPublishedBlogPostsFromDb only filtered on
 * `status: "PUBLISHED"`), so the owner had no way to schedule a post ahead
 * of time. Covers the DB-backed half of the fix — that
 * `publishedAt: { lte: new Date() }` actually keeps a future-dated post out
 * of both getPublishedBlogPosts() (the /blog listing and
 * generateStaticParams) and getBlogPostBySlug() (so /blog/[slug] 404s)
 * until its own scheduled instant arrives. See src/lib/blog/index.test.ts
 * for the cache-invalidation-contract unit coverage, and
 * src/lib/format/datetime.test.ts / src/lib/orders/number.test.ts for the
 * IST-timezone unit coverage this same package added.
 */
function fixture(overrides: { slug: string; publishedAt: Date }) {
  return {
    slug: overrides.slug,
    title: "Blog visibility test post",
    excerpt: "Excerpt long enough to look like real content for this fixture.",
    category: "Guide",
    author: "Integration Test",
    publishedAt: overrides.publishedAt,
    readTime: "3 min read",
    image: "https://example.com/blog.jpg",
    content: JSON.stringify(["Paragraph one.", "Paragraph two."]),
    status: "PUBLISHED" as const,
  };
}

describe("blog visibility respects publishedAt (F-331)", () => {
  const createdSlugs: string[] = [];
  const pastSlug = `f-331-past-${randomUUID().slice(0, 8)}`;
  const futureSlug = `f-331-future-${randomUUID().slice(0, 8)}`;

  before(async () => {
    const now = Date.now();
    await db.blogPostRecord.create({
      data: fixture({ slug: pastSlug, publishedAt: new Date(now - 24 * 60 * 60 * 1000) }),
    });
    createdSlugs.push(pastSlug);
    await db.blogPostRecord.create({
      data: fixture({ slug: futureSlug, publishedAt: new Date(now + 24 * 60 * 60 * 1000) }),
    });
    createdSlugs.push(futureSlug);
  });

  after(async () => {
    await db.blogPostRecord.deleteMany({ where: { slug: { in: createdSlugs } } }).catch(() => {});
  });

  it("getPublishedBlogPosts() includes a PUBLISHED post whose publishedAt is in the past", async () => {
    const posts = await getPublishedBlogPosts();
    assert.ok(posts.some((post) => post.slug === pastSlug), "past-dated published post should be listed");
  });

  it("getPublishedBlogPosts() excludes a PUBLISHED post whose publishedAt is still in the future", async () => {
    const posts = await getPublishedBlogPosts();
    assert.ok(
      !posts.some((post) => post.slug === futureSlug),
      "future-dated published post should not be listed yet",
    );
  });

  it("getBlogPostBySlug() resolves a PUBLISHED post whose publishedAt is in the past", async () => {
    const post = await getBlogPostBySlug(pastSlug);
    assert.ok(post, "past-dated published post should resolve");
    assert.equal(post?.slug, pastSlug);
  });

  it("getBlogPostBySlug() returns null (so the page 404s) for a PUBLISHED post whose publishedAt is still in the future", async () => {
    const post = await getBlogPostBySlug(futureSlug);
    assert.equal(post, null, "future-dated published post should not resolve yet");
  });
});
