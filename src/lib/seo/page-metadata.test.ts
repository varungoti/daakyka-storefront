import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import manifest from "@/app/manifest";
import { metadata as notFoundMetadata } from "@/app/not-found";
import { generateMetadata as newsletterConfirmedMetadata } from "@/app/newsletter/confirmed/page";
import { metadata as unsubscribeMetadata } from "@/app/unsubscribe/page";
import { resolveCategoryMetadata } from "@/lib/seo/category-seo";
import { siteVerification } from "@/lib/seo/verification";

/**
 * release-hardening F-147/F-151/F-045/F-012/F-089/F-098/F-320: per-route SEO
 * metadata. Next merges metadata per key across segments, so a page that
 * forgets `alternates`/`openGraph` used to silently inherit the homepage's
 * canonical and social card from the root layout — these keep that from
 * regressing without needing a running server.
 */

const APP_DIR = path.resolve(process.cwd(), "src/app");

function readSource(relative: string): string {
  return readFileSync(path.join(APP_DIR, relative), "utf8");
}

/** Drops // and block comments, so a doc comment that merely mentions
 * "canonical" or "alternates" can't satisfy (or trip) a source check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findPages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findPages(full));
    else if (entry === "page.tsx") found.push(full);
  }
  return found;
}

// Per-visitor / transactional pages: noindex rather than a canonical. An
// explicit list (not "any page mentioning `index: false`") because the
// dynamic pages' *not-found* branch also sets `index: false`, which must not
// excuse their found branch from having a canonical.
const NOINDEX_PAGES = [
  "checkout/page.tsx",
  "mix-and-match/studio/page.tsx",
  "newsletter/confirmed/page.tsx",
  "order/[number]/page.tsx",
  "unsubscribe/page.tsx",
];

// /admin is behind its own auth + noindex layout; /account is covered by
// src/app/account/layout.tsx (asserted below), so neither needs a canonical.
const PAGES = findPages(APP_DIR)
  .map((file) => path.relative(APP_DIR, file).replace(/\\/g, "/"))
  .filter((file) => !file.startsWith("admin/") && !file.startsWith("account/"));

describe("every public page declares its own canonical and og:url (F-147, F-151)", () => {
  it("found the app's pages", () => {
    assert.ok(PAGES.length > 20, `expected to find the storefront pages, got ${PAGES.length}`);
    assert.ok(PAGES.includes("page.tsx"));
    assert.ok(PAGES.includes("products/[handle]/page.tsx"));
  });

  it("every indexable page sets a canonical and an og:url (or is noindex / redirect-only)", () => {
    const missingCanonical: string[] = [];
    const missingOgUrl: string[] = [];
    for (const page of PAGES) {
      const source = stripComments(readSource(page));
      const redirectOnly = /\b(permanentRedirect|redirect)\(/.test(source) && !/metadata/i.test(source);
      if (NOINDEX_PAGES.includes(page) || redirectOnly) continue;
      // policyMetadata(title, description, path) builds both from its path.
      const viaPolicy = /\bpolicyMetadata\(/.test(source);
      if (!viaPolicy && !/\bcanonicalPath\(/.test(source)) missingCanonical.push(page);
      if (!viaPolicy && !/\bbaseOpenGraph\(/.test(source)) missingOgUrl.push(page);
    }
    assert.deepEqual(missingCanonical, [], "pages that would inherit no (or a wrong) canonical");
    assert.deepEqual(missingOgUrl, [], "pages with no og:url");
  });

  it("the root layout sets no canonical and no hard-coded social title/description", () => {
    const layout = stripComments(readSource("layout.tsx"));
    assert.ok(!/alternates\s*:/.test(layout), "a root canonical is inherited by every page that forgets its own");
    const openGraph = layout.match(/openGraph:\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] ?? "";
    const twitter = layout.match(/twitter:\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] ?? "";
    assert.ok(openGraph.length > 0 && twitter.length > 0, "expected to find the layout's openGraph/twitter objects");
    for (const block of [openGraph, twitter]) {
      assert.ok(!/\btitle\s*:/.test(block) && !/\bdescription\s*:/.test(block));
    }
  });
});

describe("noindex pages (F-045, F-147)", () => {
  it("every transactional page is noindex", () => {
    for (const page of NOINDEX_PAGES) {
      assert.ok(PAGES.includes(page), `${page} no longer exists — update NOINDEX_PAGES`);
      assert.match(stripComments(readSource(page)), /index:\s*false/, `${page} must be noindex`);
    }
  });

  it("every /account route is noindex via src/app/account/layout.tsx", () => {
    assert.match(stripComments(readSource("account/layout.tsx")), /robots:\s*\{\s*index:\s*false/);
  });

  it("/unsubscribe is noindex", () => {
    assert.equal(unsubscribeMetadata.robots && typeof unsubscribeMetadata.robots === "object" && unsubscribeMetadata.robots.index, false);
  });

  it("/newsletter/confirmed is noindex and its title follows the status", async () => {
    const ok = await newsletterConfirmedMetadata({ searchParams: Promise.resolve({ status: "ok" }) });
    const failed = await newsletterConfirmedMetadata({ searchParams: Promise.resolve({}) });
    assert.equal(ok.title, "Subscription Confirmed");
    assert.equal(failed.title, "Confirmation Failed");
    for (const metadata of [ok, failed]) {
      assert.deepEqual(metadata.robots, { index: false, follow: false });
    }
  });
});

describe("root 404 (F-012)", () => {
  it("has its own title and a single, non-conflicting robots directive", () => {
    assert.equal(notFoundMetadata.title, "Page not found");
    assert.deepEqual(notFoundMetadata.robots, { index: false, follow: true });
  });

  it("offers a search box and the section landings", () => {
    const source = readSource("not-found.tsx");
    assert.match(source, /action="\/shop"/);
    assert.match(source, /name="q"/);
    for (const href of ["/for-hospitals", "/school-uniforms", "/kids-wear"]) {
      assert.ok(source.includes(href), `expected a link to ${href}`);
    }
  });

  it("no segment-level loading.tsx stops notFound() from returning a 404 status", () => {
    // A loading.tsx makes Next stream the segment, and once streaming has
    // started the status can't change to 404 (a soft 404).
    for (const dir of ["products/[handle]", "category/[slug]"]) {
      assert.throws(() => readSource(`${dir}/loading.tsx`), /ENOENT/);
    }
  });
});

describe("theme colour and favicon (F-089)", () => {
  it("the layout's viewport themeColor matches the web manifest's theme_color", () => {
    const themeColor = stripComments(readSource("layout.tsx")).match(/themeColor:\s*"(#[0-9a-fA-F]{6})"/)?.[1];
    assert.ok(themeColor, "expected layout.tsx to export viewport.themeColor");
    assert.equal(themeColor!.toLowerCase(), manifest().theme_color!.toLowerCase());
  });

  it("serves a real /favicon.ico", () => {
    const icon = readFileSync(path.join(APP_DIR, "favicon.ico"));
    // ICONDIR: reserved 0, type 1 (icon).
    assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
  });
});

describe("resolveCategoryMetadata (F-098)", () => {
  const fallback = { title: "Scrub Tops", description: "Browse scrub tops." };

  it("uses the category's own name and description when no SEO fields are set", () => {
    assert.deepEqual(resolveCategoryMetadata(fallback, null), fallback);
    assert.deepEqual(resolveCategoryMetadata(fallback, { seoTitle: null, seoDescription: null }), fallback);
  });

  it("prefers the admin's SEO title (absolute, so the brand template isn't doubled) and description", () => {
    const result = resolveCategoryMetadata(fallback, {
      seoTitle: "  Buy Scrub Tops Online | DAAKYKA  ",
      seoDescription: "Custom SEO description.",
    });
    assert.deepEqual(result.title, { absolute: "Buy Scrub Tops Online | DAAKYKA" });
    assert.equal(result.description, "Custom SEO description.");
  });

  it("falls back per field, and ignores whitespace-only values", () => {
    const onlyTitle = resolveCategoryMetadata(fallback, { seoTitle: "Only Title", seoDescription: "   " });
    assert.deepEqual(onlyTitle.title, { absolute: "Only Title" });
    assert.equal(onlyTitle.description, fallback.description);

    const onlyDescription = resolveCategoryMetadata(fallback, { seoTitle: "  ", seoDescription: "Only Description" });
    assert.equal(onlyDescription.title, fallback.title);
    assert.equal(onlyDescription.description, "Only Description");
  });
});

describe("siteVerification (F-320)", () => {
  it("emits nothing until the owner sets the env vars", () => {
    assert.deepEqual(siteVerification({}), { google: undefined, other: undefined });
    assert.deepEqual(siteVerification({ GOOGLE_SITE_VERIFICATION: "", FB_DOMAIN_VERIFICATION: "" }), {
      google: undefined,
      other: undefined,
    });
  });

  it("maps GOOGLE_SITE_VERIFICATION and FB_DOMAIN_VERIFICATION onto the verification meta tags", () => {
    assert.deepEqual(siteVerification({ GOOGLE_SITE_VERIFICATION: "g-token", FB_DOMAIN_VERIFICATION: "fb-token" }), {
      google: "g-token",
      other: { "facebook-domain-verification": "fb-token" },
    });
  });
});
