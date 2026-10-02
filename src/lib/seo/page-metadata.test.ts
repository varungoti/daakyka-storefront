import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import manifest from "@/app/manifest";
import { metadata as notFoundMetadata } from "@/app/not-found";
import { generateMetadata as newsletterConfirmedMetadata } from "@/app/newsletter/confirmed/page";
import { metadata as unsubscribeMetadata } from "@/app/unsubscribe/page";
import { SEO_GUIDE_SLUGS } from "@/data/seo-guide-slugs";
import { seoLandingPages } from "@/data/seo-landing-pages";
import { mergeSeoOverride } from "@/lib/seo/apply-override";
import { resolveCategoryMetadata } from "@/lib/seo/category-seo";
import { siteVerification } from "@/lib/seo/verification";
import { STATIC_WIRED_SEO_PATHS, WIRED_SEO_PATHS, isWiredSeoPath } from "@/lib/seo/wired-paths";

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

/**
 * F-052: an admin override saved in /admin/seo only reaches a page whose
 * generateMetadata() reads it. WIRED_SEO_PATHS is the list the admin form
 * offers and the API accepts, so it must be exactly the set of pages that
 * really do — a path listed but not wired would repeat the original bug (an
 * override that "saves" and never applies).
 */
describe("admin SEO overrides reach every wired page (F-052)", () => {
  // The page file behind each static wired path (the guides share one file).
  const PAGE_FILE: Record<(typeof STATIC_WIRED_SEO_PATHS)[number], string> = {
    "/": "page.tsx",
    "/shop": "shop/page.tsx",
    "/bulk-orders": "bulk-orders/page.tsx",
    "/about": "about/page.tsx",
    "/contact": "contact/page.tsx",
    "/guides": "guides/page.tsx",
  };

  it("lists the home, shop, bulk-orders, about, contact and guides pages plus every guide", () => {
    assert.deepEqual([...STATIC_WIRED_SEO_PATHS], Object.keys(PAGE_FILE));
    for (const slug of SEO_GUIDE_SLUGS) assert.ok(isWiredSeoPath(`/guides/${slug}`), slug);
    assert.equal(WIRED_SEO_PATHS.length, STATIC_WIRED_SEO_PATHS.length + SEO_GUIDE_SLUGS.length);
    assert.equal(new Set(WIRED_SEO_PATHS).size, WIRED_SEO_PATHS.length, "no duplicates");
  });

  it("does not claim paths no page reads", () => {
    for (const path of ["/size-guide", "/our-story", "/for-hospitals", "/guides/not-a-guide", "/test-seo-x", "", "/shop/"]) {
      assert.equal(isWiredSeoPath(path), false, path);
    }
  });

  it("the guide slug list is exactly the guides the app serves", () => {
    assert.deepEqual(
      [...SEO_GUIDE_SLUGS].sort(),
      seoLandingPages.map((page) => page.slug).sort(),
      "update src/data/seo-guide-slugs.ts when a guide is added or removed",
    );
  });

  it("each static wired page reads its own override in generateMetadata", () => {
    for (const [wiredPath, file] of Object.entries(PAGE_FILE)) {
      const source = stripComments(readSource(file));
      const reads =
        source.includes(`withSeoOverride("${wiredPath}"`) || source.includes(`getSeoOverrideForPath("${wiredPath}")`);
      assert.ok(reads, `${file} must read the SEO override for ${wiredPath}`);
    }
  });

  it("every guide's metadata reads the override for its own /guides/<slug> path", () => {
    const source = stripComments(readSource("guides/[slug]/page.tsx"));
    assert.ok(source.includes("withSeoOverride(`/guides/${slug}`"), "guides/[slug] must read the per-guide override");
  });

  it("no page reads an override for a path that is not wired", () => {
    const overridePaths = new Set<string>();
    for (const page of PAGES) {
      const source = stripComments(readSource(page));
      for (const match of source.matchAll(/(?:withSeoOverride|getSeoOverrideForPath)\(\s*"([^"]+)"/g)) {
        overridePaths.add(match[1]);
      }
    }
    assert.ok(overridePaths.size >= STATIC_WIRED_SEO_PATHS.length - 1);
    for (const path of overridePaths) assert.ok(isWiredSeoPath(path), `${path} reads an override but is not in WIRED_SEO_PATHS`);
  });
});

describe("mergeSeoOverride (F-052)", () => {
  const base = {
    title: "Bulk Orders",
    description: "Page description.",
    alternates: { canonical: "/bulk-orders" },
    openGraph: { url: "/bulk-orders" },
  };

  it("returns the page's own metadata when there is no override", () => {
    assert.equal(mergeSeoOverride(base, null), base);
  });

  it("replaces only the title and description, keeping the canonical and og:url", () => {
    const merged = mergeSeoOverride(base, { title: "  Uniform Quotes  ", metaDescription: " Get a quote. " });
    assert.equal(merged.title, "Uniform Quotes");
    assert.equal(merged.description, "Get a quote.");
    assert.deepEqual(merged.alternates, base.alternates);
    assert.deepEqual(merged.openGraph, base.openGraph);
  });

  it("falls back per field when an override field is blank", () => {
    const merged = mergeSeoOverride(base, { title: "   ", metaDescription: "Only the description." });
    assert.equal(merged.title, base.title);
    assert.equal(merged.description, "Only the description.");
  });
});
