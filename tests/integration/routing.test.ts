import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sitemap from "@/app/sitemap";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { getCategoryTree, getProducts, type CategoryTreeNode } from "@/lib/products";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { seedCatalog } from "../../prisma/seed-catalog";
import { findAnyAdminId } from "../helpers/admin-user";

/**
 * Phase C2/C3 routing integration tests, run against the real local dev
 * Postgres (same convention as tests/integration/catalog.test.ts and
 * site-settings.test.ts). These exercise:
 *  - getNavigation() end-to-end against the real category tree.
 *  - sitemap.ts's URL generation: new routes present, disabled pages
 *    excluded, sale gating.
 *
 * Full-page HTTP checks (GET / returns 200 with real markup, redirects
 * for /hospital-uniforms and /institutional, etc.) need an actual
 * running Next.js server — next.config.ts's `redirects()` and RSC
 * rendering aren't reachable by calling route/page modules directly the
 * way an API route handler is elsewhere in this suite. Those are
 * exercised via `npm run start` + curl instead (see the task report),
 * matching this repo's existing split between node:test integration
 * tests and tests/smoke/pages.test.ts's HTTP-level checks.
 */

describe("getNavigation() integration (Phase C2)", () => {
  before(async () => {
    await seedCatalog(db);
  });

  it("returns a Shop mega-grid and the always-on plain links", async () => {
    const nav = await getNavigation();
    const ids = nav.items.map((item) => item.id);
    assert.ok(ids.includes("shop"));
    assert.ok(ids.includes("size-guide"));
    assert.ok(ids.includes("about"));
    assert.ok(ids.includes("contact"));
    assert.ok(!ids.includes("fabric-technology"));
    assert.ok(!ids.includes("mix-and-match"));
  });

  it("builds For Hospitals, School Uniforms, and Kids Wear from the seeded catalog", async () => {
    const nav = await getNavigation();
    const hospitals = nav.items.find((item) => item.id === "for-hospitals");
    const school = nav.items.find((item) => item.id === "school-uniforms");
    const kids = nav.items.find((item) => item.id === "kids-wear");

    assert.ok(hospitals && hospitals.kind === "mega-columns");
    assert.ok(school && school.kind === "mega-columns");
    assert.ok(kids && kids.kind === "simple");

    if (hospitals?.kind === "mega-columns") {
      assert.ok(hospitals.columns.some((c) => c.heading === "Apparel"));
      assert.ok(hospitals.columns.some((c) => c.heading === "Linens"));
      assert.equal(hospitals.promo?.href, "/bulk-orders");
    }
  });
});

describe("sitemap.xml URL generation (Phase C3)", () => {
  let adminId: string;
  let originalSaleEnabled: boolean;
  let originalFabricTech: boolean;
  let originalMixMatch: boolean;

  before(async () => {
    // F-333: `{ publish: true }` (not passed by the describe block above)
    // so at least one seeded product is ACTIVE — the sitemap's product
    // entries (and this file's own lastModified assertions below) need a
    // real, visible product to check against.
    await seedCatalog(db, { publish: true });
    adminId = await findAnyAdminId();
    originalSaleEnabled = await getSetting("sale.enabled");
    originalFabricTech = await getSetting("pages.fabricTech.enabled");
    originalMixMatch = await getSetting("pages.mixMatch.enabled");
  });

  after(async () => {
    await setSetting("sale.enabled", originalSaleEnabled, adminId);
    await setSetting("pages.fabricTech.enabled", originalFabricTech, adminId);
    await setSetting("pages.mixMatch.enabled", originalMixMatch, adminId);
  });

  it("serves active products for every category link in the navigation menu", async () => {
    const navigation = await getNavigation();
    const tree = await getCategoryTree();
    const nodes = new Map<string, CategoryTreeNode>();
    const visit = (node: CategoryTreeNode) => {
      nodes.set(node.slug, node);
      node.children.forEach(visit);
    };
    tree.forEach(visit);

    const hrefs = new Set<string>();
    for (const item of navigation.items) {
      if (item.kind === "mega-grid") {
        for (const tile of item.tiles) {
          hrefs.add(tile.href);
          tile.children.forEach((child) => hrefs.add(child.href));
        }
      } else if (item.kind === "mega-columns") {
        item.columns.forEach((column) => column.items.forEach((link) => hrefs.add(link.href)));
      } else if (item.kind === "simple") {
        item.children.forEach((link) => hrefs.add(link.href));
      }
    }

    assert.ok(hrefs.size > 20, "expected the seeded navigation to contain its full catalog");
    const descendantSlugs = (node: CategoryTreeNode): string[] =>
      [node.slug, ...node.children.flatMap(descendantSlugs)];
    for (const href of hrefs) {
      const slug = href.split("/").at(-1)!;
      const node = nodes.get(slug);
      assert.ok(node, `${href} must resolve to an active category`);
      const expected = await db.product.count({
        where: {
          status: "ACTIVE",
          category: { slug: { in: descendantSlugs(node) }, active: true },
        },
      });
      assert.ok(expected > 0, `${href} must have published products`);
      const actual = await getProducts({ categorySlug: slug });
      assert.equal(actual.length, expected, `${href} must show every published product`);
    }
  });

  it("includes section landings and canonical category routes only once", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    assert.ok(urls.some((url) => url.endsWith("/for-hospitals")));
    assert.ok(urls.some((url) => url.endsWith("/school-uniforms")));
    assert.ok(urls.some((url) => url.endsWith("/kids-wear")));
    assert.ok(urls.some((url) => url.endsWith("/our-story")));
    assert.ok(!urls.some((url) => url.endsWith("/category/for-hospitals")));
    assert.ok(!urls.some((url) => url.endsWith("/category/school-uniforms")));
    assert.ok(!urls.some((url) => url.endsWith("/category/kids-wear")));
    assert.ok(urls.some((url) => url.endsWith("/category/school-shirts")));
    // Old removed routes should not be listed as canonical URLs (they
    // now 301 redirect instead) — note /guides/hospital-uniforms is a
    // *different*, still-valid SEO guide page and legitimately still
    // appears, so this checks the exact old top-level path only.
    assert.ok(!urls.some((url) => url.endsWith("/institutional")));
    assert.ok(!urls.some((url) => /(?<!\/guides)\/hospital-uniforms$/.test(url)));
  });

  it("excludes /fabric-technology and /mix-and-match when disabled", async () => {
    await setSetting("pages.fabricTech.enabled", false, adminId);
    await setSetting("pages.mixMatch.enabled", false, adminId);

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    assert.ok(!urls.some((url) => url.endsWith("/fabric-technology")));
    assert.ok(!urls.some((url) => url.endsWith("/mix-and-match")));
  });

  it("includes /fabric-technology and /mix-and-match when enabled", async () => {
    await setSetting("pages.fabricTech.enabled", true, adminId);
    await setSetting("pages.mixMatch.enabled", true, adminId);

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    assert.ok(urls.some((url) => url.endsWith("/fabric-technology")));
    assert.ok(urls.some((url) => url.endsWith("/mix-and-match")));
  });

  it("includes /sale only when sale.enabled is true", async () => {
    await setSetting("sale.enabled", true, adminId);
    const enabledEntries = await sitemap();
    assert.ok(enabledEntries.some((entry) => entry.url.endsWith("/sale")));

    await setSetting("sale.enabled", false, adminId);
    const disabledEntries = await sitemap();
    assert.ok(!disabledEntries.some((entry) => entry.url.endsWith("/sale")));
  });

  // F-333: lastModified used to be the sitemap's own build/regeneration
  // time (`const now = new Date()`) for every route except blog posts, so
  // a single deploy or blog edit stamped 59+ unrelated URLs as "changed
  // today". Each entry should now carry its own real timestamp — or none
  // at all for hardcoded routes with no real one to report.
  it("omits lastModified for hardcoded static routes", async () => {
    const entries = await sitemap();
    const ourStory = entries.find((entry) => entry.url.endsWith("/our-story"));
    assert.ok(ourStory, "expected to find the hardcoded /our-story route entry");
    assert.equal(ourStory!.lastModified, undefined, "a hardcoded static route has no real updatedAt to report");
  });

  it("stamps a category URL with that category's own real updatedAt, not the build time", async () => {
    const category = await db.category.findFirst({ where: { slug: "school-shirts" } });
    assert.ok(category, "expected the seeded school-shirts category to exist");

    const entries = await sitemap();
    const entry = entries.find((e) => e.url.endsWith("/category/school-shirts"));
    assert.ok(entry, "expected a /category/school-shirts sitemap entry");
    assert.equal(new Date(entry!.lastModified!).toISOString(), category!.updatedAt.toISOString());
  });

  it("stamps a product URL with that product's own real updatedAt, not the build time", async () => {
    const product = await db.product.findFirst({ where: { status: "ACTIVE" } });
    assert.ok(product, "expected at least one seeded ACTIVE product to exist");

    const entries = await sitemap();
    // Product.slug is the DB column; it's surfaced to the storefront (and
    // used in the sitemap URL) as `handle` — see src/lib/products/index.ts.
    const entry = entries.find((e) => e.url.endsWith(`/products/${product!.slug}`));
    assert.ok(entry, `expected a /products/${product!.slug} sitemap entry`);
    assert.equal(new Date(entry!.lastModified!).toISOString(), product!.updatedAt.toISOString());
  });
});
