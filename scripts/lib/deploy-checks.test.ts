import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractCanonicalHref,
  homepageHasNoindexMeta,
  isLikelyProtectedVercelAlias,
  isRedirectStatus,
  isSsoRedirectLocation,
  pickProductionHostname,
  robotsTxtBlocksAll,
  robotsTxtHasSitemap,
  vercelIgnoreCoversEnvSecrets,
} from "./deploy-checks.mjs";

/**
 * Pure unit tests for scripts/go-live.mjs's preflight/smoke checks — see
 * deploy-checks.mjs's own header comment for the two findings (F-054,
 * F-228) these exist to catch. No network, no DB: every check here is
 * proven correct on fixed strings, independent of the real deployment.
 */

describe("robotsTxtBlocksAll (F-054)", () => {
  it("flags a bare Disallow: / with no Allow rule", () => {
    assert.equal(robotsTxtBlocksAll("User-Agent: *\nDisallow: /"), true);
  });

  it("does not flag the normal allow-most robots.txt", () => {
    const body = "User-Agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /checkout\nSitemap: https://daakyka.com/sitemap.xml";
    assert.equal(robotsTxtBlocksAll(body), false);
  });

  it("does not flag a Disallow: /admin/ style rule", () => {
    assert.equal(robotsTxtBlocksAll("User-Agent: *\nAllow: /\nDisallow: /admin/"), false);
  });
});

describe("robotsTxtHasSitemap", () => {
  it("detects a Sitemap: line", () => {
    assert.equal(robotsTxtHasSitemap("User-Agent: *\nAllow: /\nSitemap: https://daakyka.com/sitemap.xml"), true);
  });

  it("is false when there is none", () => {
    assert.equal(robotsTxtHasSitemap("User-Agent: *\nDisallow: /"), false);
  });
});

describe("homepageHasNoindexMeta (F-054)", () => {
  it("detects the noindex meta tag Next renders when indexing is off", () => {
    assert.equal(
      homepageHasNoindexMeta('<head><meta name="robots" content="noindex, nofollow"/></head>'),
      true,
    );
  });

  it("is false for index,follow", () => {
    assert.equal(homepageHasNoindexMeta('<head><meta name="robots" content="index, follow"/></head>'), false);
  });

  it("is false with no robots meta tag at all", () => {
    assert.equal(homepageHasNoindexMeta("<head><title>DAAKYKA</title></head>"), false);
  });
});

describe("extractCanonicalHref", () => {
  it("extracts the canonical href", () => {
    assert.equal(
      extractCanonicalHref('<link rel="canonical" href="https://storefront-nu-woad.vercel.app/"/>'),
      "https://storefront-nu-woad.vercel.app/",
    );
  });

  it("returns null when there is no canonical tag", () => {
    assert.equal(extractCanonicalHref("<head></head>"), null);
  });
});

describe("isLikelyProtectedVercelAlias (F-007)", () => {
  it("flags the team-scoped -projects.vercel.app alias", () => {
    assert.equal(isLikelyProtectedVercelAlias("https://storefront-varubs-projects.vercel.app"), true);
  });

  it("does not flag the project's own public vercel.app alias", () => {
    assert.equal(isLikelyProtectedVercelAlias("https://storefront-nu-woad.vercel.app"), false);
  });

  it("does not flag a custom domain", () => {
    assert.equal(isLikelyProtectedVercelAlias("https://daakyka.com"), false);
  });

  it("does not throw on a malformed URL", () => {
    assert.equal(isLikelyProtectedVercelAlias("not-a-url"), false);
  });
});

describe("vercelIgnoreCoversEnvSecrets (F-228)", () => {
  it("accepts this repo's actual .vercelignore shape", () => {
    const content = [".env", ".env.*", "!.env*.example", ".claude/", "bin/cloudflared.exe"].join("\n");
    assert.equal(vercelIgnoreCoversEnvSecrets(content), true);
  });

  it("rejects an empty file (the pre-fix state — no .vercelignore at all)", () => {
    assert.equal(vercelIgnoreCoversEnvSecrets(""), false);
  });

  it("rejects a file that only excludes .env.local (the Vercel CLI's own default)", () => {
    assert.equal(vercelIgnoreCoversEnvSecrets(".env.local\n.env.*.local"), false);
  });

  it("rejects a broad .env* rule that wrongly re-ignores the .example templates (negation ordered before the broad rule)", () => {
    // Regression for the exact .gitignore bug this release also fixed:
    // a negation only wins when it comes AFTER the pattern it's meant to
    // un-ignore.
    const content = ["!.env*.example", ".env*"].join("\n");
    assert.equal(vercelIgnoreCoversEnvSecrets(content), false);
  });

  it("accepts the negation ordered after the broad rule", () => {
    const content = [".env*", "!.env*.example"].join("\n");
    assert.equal(vercelIgnoreCoversEnvSecrets(content), true);
  });
});

describe("pickProductionHostname (F-354)", () => {
  it("prefers a custom domain over any *.vercel.app alias", () => {
    const inspect = {
      url: "storefront-kgagbak0s-varubs-projects.vercel.app",
      alias: ["storefront-nu-woad.vercel.app", "daakyka.com"],
    };
    assert.equal(pickProductionHostname(inspect), "daakyka.com");
  });

  it("prefers the public vercel.app alias over the SSO-protected -projects.vercel.app one", () => {
    const inspect = {
      url: "storefront-kgagbak0s-varubs-projects.vercel.app",
      alias: ["storefront-varubs-projects.vercel.app", "storefront-nu-woad.vercel.app"],
    };
    assert.equal(pickProductionHostname(inspect), "storefront-nu-woad.vercel.app");
  });

  it("falls back to whatever hostname it finds when there is no alias array", () => {
    assert.equal(
      pickProductionHostname({ url: "https://storefront-nu-woad.vercel.app" }),
      "storefront-nu-woad.vercel.app",
    );
  });

  it("returns null when nothing hostname-shaped is found", () => {
    assert.equal(pickProductionHostname({ id: "dpl_abc123", readyState: "READY" }), null);
  });

  it("does not throw on null/undefined input", () => {
    assert.equal(pickProductionHostname(null), null);
    assert.equal(pickProductionHostname(undefined), null);
  });
});

describe("isRedirectStatus", () => {
  it("is true for 301/302/307/308", () => {
    for (const status of [301, 302, 307, 308]) assert.equal(isRedirectStatus(status), true);
  });

  it("is false for 200 and 404", () => {
    assert.equal(isRedirectStatus(200), false);
    assert.equal(isRedirectStatus(404), false);
  });
});

describe("isSsoRedirectLocation (F-354)", () => {
  it("flags a redirect to vercel.com/sso-api", () => {
    assert.equal(isSsoRedirectLocation("https://vercel.com/sso-api?url=%2F"), true);
  });

  it("does not flag a redirect within the app's own domain", () => {
    assert.equal(isSsoRedirectLocation("https://daakyka.com/shop"), false);
    assert.equal(isSsoRedirectLocation("/shop"), false);
  });

  it("does not throw on a missing header", () => {
    assert.equal(isSsoRedirectLocation(null), false);
    assert.equal(isSsoRedirectLocation(undefined), false);
  });
});
