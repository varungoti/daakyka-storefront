import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sitemap from "@/app/sitemap";
import { getNavigation } from "@/lib/navigation/get-navigation";
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
    await seedCatalog(db);
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

  it("includes the new C3 section-landing and category routes", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    assert.ok(urls.some((url) => url.endsWith("/for-hospitals")));
    assert.ok(urls.some((url) => url.endsWith("/school-uniforms")));
    assert.ok(urls.some((url) => url.endsWith("/kids-wear")));
    assert.ok(urls.some((url) => url.endsWith("/our-story")));
    assert.ok(urls.some((url) => url.endsWith("/category/for-hospitals")));
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
});
