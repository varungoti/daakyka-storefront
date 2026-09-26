import { describe, it } from "node:test";
import assert from "node:assert/strict";
import robots from "@/app/robots";
import { withEnv } from "../../tests/helpers/env";

/**
 * F-054 regression: a leftover NEXT_PUBLIC_ALLOW_INDEXING=false from when
 * this URL used to be staging silently blocked all search indexing on
 * production (bare "Disallow: /", no Sitemap line) with nothing catching
 * it — see src/lib/env.ts's isIndexingAllowed, which this route wraps, and
 * scripts/go-live.mjs's smoke-stage checks (scripts/lib/deploy-checks.test.ts)
 * for the deployed-site side of the same fix.
 */
describe("robots.ts", () => {
  it("allows the site and includes a sitemap line when NEXT_PUBLIC_ALLOW_INDEXING is unset", async () => {
    await withEnv({ NEXT_PUBLIC_ALLOW_INDEXING: undefined, VERCEL_ENV: undefined }, () => {
      const result = robots();
      assert.deepEqual(result.rules, [
        { userAgent: "*", allow: "/", disallow: ["/admin/", "/api/", "/checkout"] },
      ]);
      assert.equal(typeof result.sitemap, "string");
      assert.ok((result.sitemap as string).endsWith("/sitemap.xml"));
    });
  });

  it("allows the site when NEXT_PUBLIC_ALLOW_INDEXING=true", async () => {
    await withEnv({ NEXT_PUBLIC_ALLOW_INDEXING: "true", VERCEL_ENV: undefined }, () => {
      const result = robots();
      assert.deepEqual(result.rules, [
        { userAgent: "*", allow: "/", disallow: ["/admin/", "/api/", "/checkout"] },
      ]);
    });
  });

  it("blocks everything with no sitemap only when NEXT_PUBLIC_ALLOW_INDEXING=false", async () => {
    await withEnv({ NEXT_PUBLIC_ALLOW_INDEXING: "false", VERCEL_ENV: undefined }, () => {
      const result = robots();
      assert.deepEqual(result.rules, [{ userAgent: "*", disallow: "/" }]);
      assert.equal(result.sitemap, undefined);
    });
  });
});
