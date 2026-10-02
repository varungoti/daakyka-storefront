import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blogPosts } from "@/data/blog";
import { seoLandingPages } from "@/data/seo-landing-pages";
import {
  blogPostCanonicalPath,
  canonicalPath,
  SECTION_LANDING_PATH_BY_CATEGORY_SLUG,
  sectionLandingPath,
} from "@/lib/seo/canonical";

describe("canonicalPath", () => {
  it("returns / for the root path", () => {
    assert.equal(canonicalPath("/"), "/");
    assert.equal(canonicalPath(""), "/");
  });

  it("keeps a leading slash on ordinary paths", () => {
    assert.equal(canonicalPath("/shop"), "/shop");
    assert.equal(canonicalPath("/category/scrub-sets"), "/category/scrub-sets");
  });

  it("adds a leading slash if the caller forgets one", () => {
    assert.equal(canonicalPath("shop"), "/shop");
  });

  it("never carries a query string through", () => {
    const withQuery = canonicalPath("/shop");
    assert.ok(!withQuery.includes("?"));
  });
});

// release-hardening F-101: /category/<section> duplicates the section's landing page.
describe("SECTION_LANDING_PATH_BY_CATEGORY_SLUG (F-101)", () => {
  it("maps the three sections to the landing pages the top nav links to", () => {
    assert.deepEqual(SECTION_LANDING_PATH_BY_CATEGORY_SLUG, {
      "for-hospitals": "/for-hospitals",
      "school-uniforms": "/school-uniforms",
      "kids-wear": "/kids-wear",
    });
  });

  it("looks a category up by own property only", () => {
    assert.equal(sectionLandingPath("for-hospitals"), "/for-hospitals");
    assert.equal(sectionLandingPath("scrub-tops"), undefined);
    assert.equal(sectionLandingPath("constructor"), undefined);
    assert.equal(sectionLandingPath("__proto__"), undefined);
  });
});

// release-hardening F-155: blog posts that rewrite a same-slug guide.
describe("blogPostCanonicalPath (F-155)", () => {
  it("self-canonicalizes a post that has no same-slug guide", () => {
    assert.equal(blogPostCanonicalPath("caring-for-performance-scrubs"), "/blog/caring-for-performance-scrubs");
    assert.equal(blogPostCanonicalPath("a-brand-new-post"), "/blog/a-brand-new-post");
  });

  it("canonicalizes a post that duplicates a guide to that guide", () => {
    assert.equal(
      blogPostCanonicalPath("best-colors-for-hospital-uniforms"),
      "/guides/best-colors-for-hospital-uniforms",
    );
    assert.equal(
      blogPostCanonicalPath("how-to-choose-medical-scrubs"),
      "/guides/how-to-choose-medical-scrubs",
    );
  });

  it("agrees with the guide slugs for every seeded blog post", () => {
    const guideSlugs = new Set(seoLandingPages.map((page) => page.slug));
    for (const post of blogPosts) {
      assert.equal(
        blogPostCanonicalPath(post.slug),
        guideSlugs.has(post.slug) ? `/guides/${post.slug}` : `/blog/${post.slug}`,
      );
    }
  });
});
