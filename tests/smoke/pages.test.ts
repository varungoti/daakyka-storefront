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
    "/mix-and-match",
    "/fabric-technology",
    "/bulk-orders",
    "/institutional",
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

  it("homepage includes security headers", async () => {
    const response = await fetch(`${BASE}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("sitemap includes product PDP URLs", async () => {
    const response = await fetch(`${BASE}/sitemap.xml`);
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.match(xml, /\/products\/v-neck-top-lilac/);
  });

  it("health endpoint reports catalog source", async () => {
    const body = await fetchJson<{ status: string; catalog: string }>("/api/health");
    assert.equal(body.status, "ok");
    assert.ok(["seed", "shopify"].includes(body.catalog));
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
