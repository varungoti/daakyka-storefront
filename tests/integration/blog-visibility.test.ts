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

/**
 * F-051: readPublishedBlogPostsFromDb / readBlogPostBySlugFromDb used to fall
 * back to the hardcoded src/data/blog.ts posts whenever no PUBLISHED row
 * matched, so drafting or deleting one of the three launch articles left
 * /blog/<slug> serving the old copy, and drafting every post made /blog list
 * the seed ones. The database is now the only source.
 */
describe("blog has no hardcoded-seed fallback (F-051)", () => {
  const LAUNCH_SLUG = "caring-for-performance-scrubs";
  const slug = `f-051-${randomUUID().slice(0, 8)}`;

  after(async () => {
    await db.blogPostRecord.deleteMany({ where: { slug } }).catch(() => {});
  });

  it("returns null for a post that is drafted, and for one that is deleted", async () => {
    await db.blogPostRecord.create({
      data: fixture({ slug, publishedAt: new Date(Date.now() - 60 * 60 * 1000) }),
    });
    assert.equal((await getBlogPostBySlug(slug))?.slug, slug);

    await db.blogPostRecord.updateMany({ where: { slug }, data: { status: "DRAFT" } });
    assert.equal(await getBlogPostBySlug(slug), null, "a drafted post must 404");
    assert.ok(!(await getPublishedBlogPosts()).some((post) => post.slug === slug));

    await db.blogPostRecord.updateMany({ where: { slug }, data: { status: "PUBLISHED" } });
    assert.equal((await getBlogPostBySlug(slug))?.slug, slug);

    await db.blogPostRecord.deleteMany({ where: { slug } });
    assert.equal(await getBlogPostBySlug(slug), null, "a deleted post must 404");
  });

  it("does not resurrect a launch article from src/data/blog.ts once it is unpublished", async () => {
    const existing = await db.blogPostRecord.findUnique({ where: { slug: LAUNCH_SLUG } });
    try {
      if (existing) {
        await db.blogPostRecord.update({ where: { slug: LAUNCH_SLUG }, data: { status: "DRAFT" } });
      }
      assert.equal(await getBlogPostBySlug(LAUNCH_SLUG), null);
      assert.ok(!(await getPublishedBlogPosts()).some((post) => post.slug === LAUNCH_SLUG));
    } finally {
      if (existing) {
        await db.blogPostRecord.update({ where: { slug: LAUNCH_SLUG }, data: { status: existing.status } });
      }
    }
  });

  it("lists nothing, rather than every hardcoded post, when no post is published", async () => {
    const published = await db.blogPostRecord.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true },
    });
    const ids = published.map((row) => row.id);
    try {
      await db.blogPostRecord.updateMany({ where: { id: { in: ids } }, data: { status: "DRAFT" } });
      assert.deepEqual(await getPublishedBlogPosts(), []);
    } finally {
      await db.blogPostRecord.updateMany({ where: { id: { in: ids } }, data: { status: "PUBLISHED" } });
    }
  });
});
