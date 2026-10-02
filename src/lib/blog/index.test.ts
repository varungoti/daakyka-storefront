import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BLOG_CACHE_TAG, revalidateBlogCache } from "@/lib/blog/index";
import { blogSlugify, paragraphsFromDraft, parseBlogContent } from "@/lib/blog/content";

describe("revalidateBlogCache", () => {
  // F-214: "max" is stale-while-revalidate, so the owner's first reload after
  // Save still showed the old content. { expire: 0 } forces a fresh read.
  it("invokes the revalidate function with the blog tag and an immediate ({ expire: 0 }) profile", () => {
    const calls: Array<[string, string | { expire?: number }]> = [];
    revalidateBlogCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[BLOG_CACHE_TAG, { expire: 0 }]]);
  });

  it("swallows an error thrown by the revalidate function instead of throwing", () => {
    assert.doesNotThrow(() => {
      revalidateBlogCache(() => {
        throw new Error("no static generation store in this context");
      });
    });
  });

  it("defaults to the real next/cache revalidateTag and still doesn't throw outside a Next request scope", () => {
    assert.doesNotThrow(() => {
      revalidateBlogCache();
    });
  });
});

// F-213: every reader used to `JSON.parse(record.content) as string[]`, so a
// row holding anything else (the plain text a Hermes draft stored) crashed
// the admin editor and, if PUBLISHED, made the whole public blog fall back to
// the seed posts.
describe("parseBlogContent (F-213)", () => {
  it("reads the normal JSON-array body back unchanged", () => {
    assert.deepEqual(parseBlogContent(JSON.stringify(["One.", "Two."])), ["One.", "Two."]);
  });

  it("does not throw on legacy plain text, and splits it on blank lines", () => {
    assert.deepEqual(parseBlogContent("First paragraph.\n\nSecond paragraph."), ["First paragraph.", "Second paragraph."]);
    assert.deepEqual(parseBlogContent("A single paragraph with no JSON in it."), ["A single paragraph with no JSON in it."]);
  });

  it("treats a JSON string value as text, and drops non-string / empty entries", () => {
    assert.deepEqual(parseBlogContent(JSON.stringify("Alpha.\n\nBeta.")), ["Alpha.", "Beta."]);
    assert.deepEqual(parseBlogContent(JSON.stringify(["Kept.", "", "  ", 7, null])), ["Kept."]);
  });

  it("returns an empty list for empty / missing content", () => {
    assert.deepEqual(parseBlogContent(""), []);
    assert.deepEqual(parseBlogContent(null), []);
    assert.deepEqual(parseBlogContent(undefined), []);
  });
});

describe("paragraphsFromDraft (F-213)", () => {
  const fallback = ["Summary line.", "Draft generated from Hermes approval."];

  it("uses an array as-is, a string split on blank lines, and the fallback otherwise", () => {
    assert.deepEqual(paragraphsFromDraft(["A", " B "], fallback), ["A", "B"]);
    assert.deepEqual(paragraphsFromDraft("A\n\nB", fallback), ["A", "B"]);
    assert.deepEqual(paragraphsFromDraft(undefined, fallback), fallback);
    assert.deepEqual(paragraphsFromDraft(42, fallback), fallback);
    assert.deepEqual(paragraphsFromDraft("   ", fallback), fallback);
  });

  it("always returns at least one paragraph", () => {
    assert.deepEqual(paragraphsFromDraft(undefined, []), ["Draft generated from Hermes approval."]);
  });
});

describe("blogSlugify (F-216 / F-213)", () => {
  it("produces the lowercase-hyphen form blogPostSchema requires", () => {
    assert.equal(blogSlugify("Hermes: blog draft"), "hermes-blog-draft");
    assert.equal(blogSlugify("  How To Care?? For Linens! "), "how-to-care-for-linens");
    assert.equal(blogSlugify("Café — Scrubs & Co."), "cafe-scrubs-co");
  });

  it("returns an empty string (so the caller picks a fallback) when nothing alphanumeric survives", () => {
    assert.equal(blogSlugify("???"), "");
    assert.equal(blogSlugify(""), "");
  });
});
