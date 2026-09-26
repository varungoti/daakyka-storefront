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

  // F-052: the audit used to check a page's raw <title> string against a
  // 20-char minimum, but every page renders under the root layout's title
  // template ("%s | DAAKYKA Apparels", src/app/layout.tsx) — so a raw title
  // like "Kids Wear" (9 chars) that really renders as "Kids Wear | DAAKYKA
  // Apparels" was flagged "Title too short" even though the live <title>
  // was fine. This is the exact false positive the finding reproduced (19
  // of 37 pages).
  it("doesn't flag a short raw title once the site's title template is applied", () => {
    const result = auditSeoPage({
      path: "/kids-wear",
      title: "Kids Wear",
      metaDescription:
        "Everyday kids' wear — T-shirts, joggers, frocks, co-ords, and hoodies from DAAKYKA Apparels.",
      h1: "Kids Wear",
    });
    assert.ok(
      !result.issues.some((issue) => issue === "Title too short"),
      `expected no "Title too short" issue, got: ${result.issues.join("; ")}`,
    );
  });

  it("still flags a genuinely empty title even with the template applied", () => {
    const result = auditSeoPage({
      path: "/kids-wear",
      title: "",
      metaDescription:
        "Everyday kids' wear — T-shirts, joggers, frocks, co-ords, and hoodies from DAAKYKA Apparels.",
      h1: "Kids Wear",
    });
    assert.ok(result.issues.includes("Title too short"));
  });

  it("checks the home page's title as-is, with no template suffix added", () => {
    // "/" is the layout's own default title — it's never run back through
    // its own template (see renderedTitle's doc comment in audit.ts) — so
    // a short title here must still be flagged, not silently padded out by
    // a suffix that was never actually appended live.
    const result = auditSeoPage({
      path: "/",
      title: "Short",
      metaDescription: "A long enough meta description for search engines and social previews.",
      h1: "Home",
    });
    assert.ok(result.issues.includes("Title too short"));
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
