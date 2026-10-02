import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateMetadata as aboutMetadata } from "@/app/about/page";
import { generateMetadata as bulkOrdersMetadata } from "@/app/bulk-orders/page";
import { generateMetadata as categoryMetadata } from "@/app/category/[slug]/page";
import { generateMetadata as contactMetadata } from "@/app/contact/page";
import { generateMetadata as forHospitalsMetadata } from "@/app/for-hospitals/page";
import { generateMetadata as guideMetadata } from "@/app/guides/[slug]/page";
import { generateMetadata as guidesIndexMetadata } from "@/app/guides/page";
import sitemap from "@/app/sitemap";
import nextConfig from "../../next.config";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { getCategoryTree, getProducts, type CategoryTreeNode } from "@/lib/products";
import { db } from "@/lib/db";
import { createSeoRecord, deleteSeoRecord, listLiveSeoOverrides, withSeoOverride } from "@/lib/seo/records";
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

  // release-hardening F-048: the sitemap used to list six URLs that
  // next.config.ts (or the page itself) redirect, plus three thin
  // "Continue to X" collection interstitials — every listed URL should be a
  // final, indexable 200.
  it("lists no URL that redirects (F-048)", async () => {
    const redirects = await nextConfig.redirects!();
    const redirectSources = new Set(redirects.map((rule) => rule.source));
    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    for (const path of paths) {
      assert.ok(!redirectSources.has(path), `${path} is in the sitemap but next.config.ts redirects it`);
    }
    // science-of-the-scrub redirects from the page itself (permanentRedirect),
    // not next.config.ts, so the generic check above can't see it.
    assert.ok(!paths.includes("/science-of-the-scrub"));
    for (const legacy of [
      "/scrubs-for-men",
      "/scrubs-for-women",
      "/custom-embroidered-scrubs",
      "/medical-scrubs",
      "/nurse-uniforms",
    ]) {
      assert.ok(!paths.includes(legacy), `${legacy} should be listed only as its /guides/ page`);
      assert.ok(paths.includes(`/guides${legacy}`), `expected /guides${legacy} in the sitemap`);
    }
    assert.ok(paths.includes("/collections/best-sellers"), "the one real collection page stays listed");
    assert.ok(!paths.some((path) => /^\/collections\/(stretch-collection|hospital-teams|bespoke)$/.test(path)));
  });

  // release-hardening F-156: the fabric-technology detail pages 404 while
  // the hub is off, and used to be missing from the sitemap even when on.
  it("lists the fabric-technology detail pages only while the hub is enabled (F-156)", async () => {
    await setSetting("pages.fabricTech.enabled", false, adminId);
    const disabled = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    assert.ok(!disabled.some((path) => path.startsWith("/fabric-technology")));

    await setSetting("pages.fabricTech.enabled", true, adminId);
    const enabled = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    assert.ok(enabled.includes("/fabric-technology"));
    assert.ok(enabled.includes("/fabric-technology/4-way-stretch"));
  });

  // release-hardening F-155: a blog post that rewrites a same-slug guide
  // canonicalizes to that guide, so it isn't listed as its own URL.
  it("leaves blog posts that canonicalize to a guide out of the sitemap (F-155)", async () => {
    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    assert.ok(!paths.includes("/blog/best-colors-for-hospital-uniforms"));
    assert.ok(!paths.includes("/blog/how-to-choose-medical-scrubs"));
    assert.ok(paths.includes("/guides/best-colors-for-hospital-uniforms"));
    assert.ok(paths.includes("/blog/caring-for-performance-scrubs"));
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

describe("category page metadata (F-098, F-101, F-012)", () => {
  const SLUG = "scrub-tops";
  let original: { seoTitle: string | null; seoDescription: string | null };

  before(async () => {
    await seedCatalog(db, { publish: true });
    const category = await db.category.findUniqueOrThrow({ where: { slug: SLUG } });
    original = { seoTitle: category.seoTitle, seoDescription: category.seoDescription };
  });

  after(async () => {
    await db.category.update({ where: { slug: SLUG }, data: original });
  });

  const categoryProps = (slug: string) => ({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  });

  it("uses the category's name and description until the admin enters SEO fields", async () => {
    await db.category.update({ where: { slug: SLUG }, data: { seoTitle: null, seoDescription: null } });
    const metadata = await categoryMetadata(categoryProps(SLUG));
    assert.equal(metadata.title, "Scrub Tops");
    assert.equal(typeof metadata.description, "string");
  });

  it("prefers the admin-entered SEO title and description (F-098)", async () => {
    await db.category.update({
      where: { slug: SLUG },
      data: { seoTitle: "Buy Scrub Tops Online | DAAKYKA", seoDescription: "Hand-written category description." },
    });
    const metadata = await categoryMetadata(categoryProps(SLUG));
    assert.deepEqual(metadata.title, { absolute: "Buy Scrub Tops Online | DAAKYKA" });
    assert.equal(metadata.description, "Hand-written category description.");
    assert.equal(metadata.alternates?.canonical, `/category/${SLUG}`);
    assert.equal(metadata.openGraph?.url, `/category/${SLUG}`);
  });

  it("applies the admin SEO fields on the section landing page too (F-098)", async () => {
    const category = await db.category.findUniqueOrThrow({ where: { slug: "for-hospitals" } });
    try {
      await db.category.update({
        where: { slug: "for-hospitals" },
        data: { seoTitle: "Hospital Scrubs & Linens | DAAKYKA", seoDescription: "Landing page SEO description." },
      });
      const metadata = await forHospitalsMetadata();
      assert.deepEqual(metadata.title, { absolute: "Hospital Scrubs & Linens | DAAKYKA" });
      assert.equal(metadata.description, "Landing page SEO description.");
      assert.equal(metadata.alternates?.canonical, "/for-hospitals");
    } finally {
      await db.category.update({
        where: { slug: "for-hospitals" },
        data: { seoTitle: category.seoTitle, seoDescription: category.seoDescription },
      });
    }
  });

  it("canonicalizes the three section categories to their landing pages (F-101)", async () => {
    for (const [slug, landing] of [
      ["for-hospitals", "/for-hospitals"],
      ["school-uniforms", "/school-uniforms"],
      ["kids-wear", "/kids-wear"],
    ]) {
      const metadata = await categoryMetadata(categoryProps(slug));
      assert.equal(metadata.alternates?.canonical, landing, `/category/${slug}`);
      assert.equal(metadata.openGraph?.url, landing, `/category/${slug} og:url`);
    }
  });

  it("gives an unknown category a noindex robots tag and no canonical (F-012)", async () => {
    const metadata = await categoryMetadata(categoryProps("no-such-category"));
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates, undefined);
  });
});

describe("page metadata honours admin SEO overrides (F-052)", () => {
  const TOUCHED_PATHS = ["/bulk-orders", "/about", "/contact", "/guides", "/guides/hospital-uniforms", "/size-guide"];
  let adminId: string;
  // Rows the seed (or an earlier run) left for these paths — put back afterwards,
  // since the tests below clear a path to see the page's own metadata.
  let originals: Awaited<ReturnType<typeof db.seoPageRecord.findMany>> = [];

  before(async () => {
    adminId = await findAnyAdminId();
    originals = await db.seoPageRecord.findMany({ where: { path: { in: TOUCHED_PATHS } } });
  });

  after(async () => {
    await db.seoPageRecord.deleteMany({ where: { path: { in: TOUCHED_PATHS } } });
    if (originals.length) await db.seoPageRecord.createMany({ data: originals });
  });

  /** Saves an override through the same service the admin API uses, replacing
   * any row the seed left for that path. */
  async function saveOverride(path: string, title: string, metaDescription: string) {
    await db.seoPageRecord.deleteMany({ where: { path } });
    return createSeoRecord({ path, title, metaDescription }, adminId);
  }

  const pages: Array<{ path: string; metadata: () => Promise<Awaited<ReturnType<typeof aboutMetadata>>> }> = [
    { path: "/bulk-orders", metadata: () => bulkOrdersMetadata() },
    { path: "/about", metadata: () => aboutMetadata() },
    { path: "/contact", metadata: () => contactMetadata() },
    { path: "/guides", metadata: () => guidesIndexMetadata() },
    {
      path: "/guides/hospital-uniforms",
      metadata: () => guideMetadata({ params: Promise.resolve({ slug: "hospital-uniforms" }) }),
    },
  ];

  for (const { path, metadata } of pages) {
    it(`${path}: a saved override replaces the title and description, and nothing else`, async () => {
      await db.seoPageRecord.deleteMany({ where: { path } });
      const own = await metadata();
      assert.ok(own.title && own.description, `${path} has its own title and description`);

      await saveOverride(path, `Override title for ${path}`, `Override description for ${path}, long enough to be a real meta description.`);
      const overridden = await metadata();
      assert.equal(overridden.title, `Override title for ${path}`);
      assert.equal(overridden.description, `Override description for ${path}, long enough to be a real meta description.`);
      // The canonical and og:url the page declares are not the admin's to change.
      assert.deepEqual(overridden.alternates, own.alternates);
      assert.deepEqual(overridden.openGraph, own.openGraph);

      // Deleting the override puts the page's own metadata back.
      const record = await db.seoPageRecord.findUniqueOrThrow({ where: { path } });
      await deleteSeoRecord(record.id, adminId);
      assert.deepEqual(await metadata(), own);
    });
  }

  it("lists only the overrides the storefront reads, in one lookup", async () => {
    await saveOverride("/about", "About override", "About override description that is long enough.");
    await db.seoPageRecord.deleteMany({ where: { path: "/size-guide" } });
    await db.seoPageRecord.create({
      data: { path: "/size-guide", title: "Not read", metaDescription: "No page reads this one.", status: "ok", issues: "[]" },
    });

    const live = await listLiveSeoOverrides();
    assert.equal(live.get("/about")?.title, "About override");
    assert.equal(live.has("/size-guide"), false, "an off-wired row is recorded but never applied");
  });

  it("withSeoOverride ignores an off-wired path even when a row exists for it", async () => {
    const base = { title: "Size Guide", description: "The page's own description." };
    assert.deepEqual(await withSeoOverride("/size-guide", base), base);
  });
});
