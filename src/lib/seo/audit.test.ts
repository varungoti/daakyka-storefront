import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditSeoPage, summarizeSeoAudits } from "@/lib/seo/audit";

describe("SEO audit", () => {
  it("flags short meta descriptions", () => {
    const result = auditSeoPage({
      path: "/test",
      title: "Test Page Title Here",
      metaDescription: "Too short",
      h1: "Test",
    });
    assert.equal(result.status, "needs_meta");
    assert.ok(result.issues.some((issue) => issue.includes("too short")));
  });

  it("passes healthy pages", () => {
    const result = auditSeoPage({
      path: "/shop",
      title: "Shop All Scrubs Collection",
      metaDescription:
        "Browse premium medical scrubs with advanced filters for color, size, fabric technology, and price.",
      h1: "Shop All Scrubs",
    });
    assert.equal(result.status, "ok");
    assert.equal(result.issues.length, 0);
  });

  it("summarizes audit batches", () => {
    const pages = [
      auditSeoPage({
        path: "/a",
        title: "Healthy Page Title Example",
        metaDescription: "A long enough meta description for search engines and social previews.",
        h1: "Healthy",
      }),
      auditSeoPage({
        path: "/b",
        title: "Short",
        metaDescription: "tiny",
        h1: "B",
      }),
    ];
    const summary = summarizeSeoAudits(pages);
    assert.equal(summary.total, 2);
    assert.equal(summary.ok, 1);
    assert.equal(summary.needsMeta, 1);
  });
});
