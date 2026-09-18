import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalPath } from "@/lib/seo/canonical";

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
