import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STATIC_SEO_PAGES, auditSeoPage, summarizeSeoAudits } from "@/lib/seo/audit";
import { ABOUT_PAGE, BULK_ORDERS_PAGE, CONTACT_PAGE, GUIDES_INDEX_PAGE } from "@/lib/seo/static-pages";

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

// F-052: the audit used to re-type each page's title and description, and
// claimed an <h1> that /about, /contact and /bulk-orders did not render (then
// flagged them "Missing H1" once they did). These four pages now take their
// strings from src/lib/seo/static-pages.ts — the same constants their
// generateMetadata() and headings use — so the audit reports what they render.
describe("SEO audit rows for the lead pages", () => {
  const PAGES = [
    { path: "/bulk-orders", file: "bulk-orders/page.tsx", constant: "BULK_ORDERS_PAGE", page: BULK_ORDERS_PAGE },
    { path: "/about", file: "about/page.tsx", constant: "ABOUT_PAGE", page: ABOUT_PAGE },
    // The contact heading is picked in contact-intent.ts (it varies with ?intent=).
    { path: "/contact", file: "contact/page.tsx", h1File: "contact/contact-intent.ts", constant: "CONTACT_PAGE", page: CONTACT_PAGE },
    { path: "/guides", file: "guides/page.tsx", constant: "GUIDES_INDEX_PAGE", page: GUIDES_INDEX_PAGE },
  ] as const;

  for (const { path: pagePath, file, constant, page, ...rest } of PAGES) {
    const h1File = "h1File" in rest ? rest.h1File : file;
    it(`${pagePath} is audited with the title, description and h1 the page renders`, () => {
      const row = STATIC_SEO_PAGES.find((entry) => entry.path === pagePath);
      assert.ok(row, `no audit row for ${pagePath}`);
      assert.equal(row.title, page.title);
      assert.equal(row.metaDescription, page.description);
      assert.equal(row.h1, page.h1);

      const source = readFileSync(path.join(process.cwd(), "src/app", file), "utf8");
      assert.ok(source.includes(`${constant}.title`), `${file} must build its <title> from ${constant}`);
      assert.ok(source.includes(`${constant}.description`), `${file} must build its description from ${constant}`);
      assert.ok(
        readFileSync(path.join(process.cwd(), "src/app", h1File), "utf8").includes(`${constant}.h1`),
        `${h1File} must render ${constant}.h1`,
      );
      assert.match(source, /titleAs="h1"/, `${file} must render the heading as an <h1>`);

      const audited = auditSeoPage(row);
      assert.ok(!audited.issues.includes("Missing H1"), `${pagePath} renders an h1`);
    });
  }
});
