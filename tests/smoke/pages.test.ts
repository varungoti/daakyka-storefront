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

  it("Phase A5: optional pages match the current CI or default feature state", async () => {
    // Both pages exist but are disabled by default (SiteSetting
    // pages.mixMatch.enabled / pages.fabricTech.enabled). An admin can
    // turn either on from /admin/site-controls. Local Docker CI explicitly
    // enables both only in its disposable DB to exercise their browser flows.
    const expected = process.env.CI_OPTIONAL_PAGES_ENABLED === "1" ? 200 : 404;
    assert.equal(await fetchStatus("/mix-and-match"), expected);
    assert.equal(await fetchStatus("/fabric-technology"), expected);
  });

  it("shop emits a description and names the optional Mix & Match destination", async () => {
    const response = await fetch(`${BASE}/shop`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<meta name="description" content="[^"]+"/);
    if (process.env.CI_OPTIONAL_PAGES_ENABLED === "1") {
      assert.match(html, /Explore Mix &amp; Match/);
    }
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

/**
 * release-hardening SEO polish (F-012, F-089, F-101, F-147, F-151): head-level
 * checks that need the rendered page — Next's metadata merging (a page that
 * sets its own `openGraph`/`alternates` replaces the root layout's whole
 * object) can't be asserted from the page modules alone.
 */
describe("smoke — SEO head", () => {
  async function fetchHtml(path: string): Promise<{ status: number; html: string }> {
    const response = await fetch(`${BASE}${path}`);
    return { status: response.status, html: await response.text() };
  }

  const metaContent = (html: string, attr: "name" | "property", key: string) =>
    html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];
  const canonicalHref = (html: string) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];

  it("F-012: unknown products, categories, collections and URLs answer a real 404", async () => {
    for (const path of [
      "/products/does-not-exist-xyz",
      "/category/does-not-exist-xyz",
      "/collections/does-not-exist-xyz",
      "/totally-bogus-url-xyz",
    ]) {
      assert.equal(await fetchStatus(path), 404, `${path} should be a 404, not a streamed 200`);
    }
  });

  it("F-012: the root 404 has its own title and no canonical or 'index, follow' robots tag", async () => {
    const { status, html } = await fetchHtml("/totally-bogus-url-xyz");
    assert.equal(status, 404);
    assert.match(html, /<title>Page not found \|/);
    assert.equal(canonicalHref(html), undefined);
    assert.doesNotMatch(html, /<meta name="robots" content="index/);
  });

  it("F-089: serves /favicon.ico and a theme-color meta tag", async () => {
    assert.equal(await fetchStatus("/favicon.ico"), 200);
    const { html } = await fetchHtml("/");
    assert.equal(metaContent(html, "name", "theme-color"), "#8A347D");
  });

  it("F-147/F-151: legal, contact and collection pages self-canonicalize and set og:url", async () => {
    for (const path of ["/returns", "/terms", "/contact", "/bulk-orders", "/size-guide", "/collections"]) {
      const { status, html } = await fetchHtml(path);
      assert.equal(status, 200, path);
      assert.ok(canonicalHref(html)?.endsWith(path), `${path} canonical was ${canonicalHref(html)}`);
      assert.ok(metaContent(html, "property", "og:url")?.endsWith(path), `${path} og:url`);
      assert.ok(metaContent(html, "property", "og:image"), `${path} should keep a share image`);
    }
  });

  it("F-101: /category/for-hospitals canonicalizes to the /for-hospitals landing page", async () => {
    const { html } = await fetchHtml("/category/for-hospitals");
    assert.ok(canonicalHref(html)?.endsWith("/for-hospitals"));
  });

  it("F-019: /shop and category pages have exactly one <h1>", async () => {
    for (const path of ["/shop", "/category/for-hospitals"]) {
      const { html } = await fetchHtml(path);
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${path} should have a single h1`);
    }
  });

  it("F-045/F-147: account and unsubscribe pages are noindex", async () => {
    for (const path of ["/account/login", "/unsubscribe", "/newsletter/confirmed"]) {
      const { html } = await fetchHtml(path);
      assert.match(html, /<meta name="robots" content="noindex/, `${path} should be noindex`);
    }
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
