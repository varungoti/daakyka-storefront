import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { seoLandingPages } from "@/data/seo-landing-pages";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

async function fetchStatus(path: string): Promise<number> {
  const response = await fetch(`${BASE}${path}`, { redirect: "follow" });
  return response.status;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  assert.equal(response.status, 200, `${path} should return 200`);
  return response.json() as Promise<T>;
}

describe("smoke — storefront pages", () => {
  const staticPages = [
    "/",
    "/shop",
    "/for-hospitals",
    "/school-uniforms",
    "/kids-wear",
    "/sale",
    "/our-story",
    "/account",
    "/bulk-orders",
    "/about",
    "/contact",
    "/blog",
    "/collections",
    "/guides",
    "/checkout",
    "/size-guide",
    "/shipping",
    "/returns",
    "/privacy-policy",
    "/terms",
    "/accessibility",
    "/api/health",
    "/sitemap.xml",
    "/robots.txt",
    "/admin/login",
  ];

  for (const path of staticPages) {
    it(`GET ${path} → 200`, async () => {
      const status = await fetchStatus(path);
      assert.equal(status, 200, `${path} returned ${status}`);
    });
  }

  for (const page of seoLandingPages) {
    it(`GET /guides/${page.slug} → 200`, async () => {
      const status = await fetchStatus(`/guides/${page.slug}`);
      assert.equal(status, 200);
    });
  }

  it("GET /api/products returns products", async () => {
    const body = await fetchJson<{ products: { handle: string }[] }>("/api/products");
    assert.ok(body.products.length > 0);
    const productStatus = await fetchStatus(`/products/${body.products[0].handle}`);
    assert.equal(productStatus, 200);
  });

  it("SEO redirect /doctor-scrubs → guide", async () => {
    const response = await fetch(`${BASE}/doctor-scrubs`, { redirect: "manual" });
    assert.ok(response.status === 308 || response.status === 307 || response.status === 200);
  });

  it("Phase C3: /hospital-uniforms and /institutional 301/308 redirect to /for-hospitals", async () => {
    for (const path of ["/hospital-uniforms", "/institutional"]) {
      const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
      assert.ok(
        response.status === 308 || response.status === 301,
        `${path} should permanently redirect, got ${response.status}`,
      );
      assert.equal(response.headers.get("location"), "/for-hospitals");
    }
  });

  it("Phase C3: /category/[slug] resolves for a real seeded category", async () => {
    const status = await fetchStatus("/category/for-hospitals");
    assert.equal(status, 200);
  });

  it("Phase A5: /mix-and-match and /fabric-technology 404 by default (admin-toggleable)", async () => {
    // Both pages exist but are disabled by default (SiteSetting
    // pages.mixMatch.enabled / pages.fabricTech.enabled). An admin can
    // turn either on from /admin/site-controls, at which point this
    // assertion would need the same override before asserting 200 —
    // this smoke run exercises the out-of-the-box default.
    assert.equal(await fetchStatus("/mix-and-match"), 404);
    assert.equal(await fetchStatus("/fabric-technology"), 404);
  });

  it("homepage includes security headers", async () => {
    const response = await fetch(`${BASE}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("sitemap includes product PDP URLs", async () => {
    // The catalog is DB-backed (Phase B3): fetch a real current handle
    // rather than a hardcoded one from the retired static seed data,
    // which no longer matches prisma/seed-catalog.ts's slugs.
    const products = await fetchJson<{ products: { handle: string }[] }>("/api/products");
    assert.ok(products.products.length > 0, "expected at least one product to check against");
    const response = await fetch(`${BASE}/sitemap.xml`);
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.match(xml, new RegExp(`/products/${products.products[0].handle}`));
  });

  it("health endpoint reports ok without leaking catalog/integration detail to an anonymous caller", async () => {
    // F4 (docs/audit-2026-09-19/security.md): the catalog source and
    // integration statuses moved behind an authenticated admin session
    // (requireAdminPermission("integrations:manage")); this unauthenticated
    // smoke request must only ever see the minimal liveness shape.
    const body = await fetchJson<{ status: string; catalog?: string; integrations?: unknown }>(
      "/api/health",
    );
    assert.equal(body.status, "ok");
    assert.equal(body.catalog, undefined);
    assert.equal(body.integrations, undefined);
  });

  it("admin API rejects unauthenticated requests", async () => {
    const response = await fetch(`${BASE}/api/admin/blog`);
    assert.equal(response.status, 401);
  });
});

describe("smoke — server reachability", () => {
  it("server is reachable at TEST_BASE_URL", async () => {
    try {
      const status = await fetchStatus("/");
      assert.equal(status, 200);
    } catch (error) {
      assert.fail(
        `Cannot reach ${BASE}. Start server with 'npm run dev' and set TEST_BASE_URL. ${error}`,
      );
    }
  });
});
