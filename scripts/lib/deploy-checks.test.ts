import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractCanonicalHref,
  homepageHasNoindexMeta,
  isLikelyProtectedVercelAlias,
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
