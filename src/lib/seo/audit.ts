import { brand } from "@/data/brand";
import { seoLandingPages } from "@/data/seo-landing-pages";
import { listLiveSeoOverrides } from "@/lib/seo/records";
import { ABOUT_PAGE, BULK_ORDERS_PAGE, CONTACT_PAGE, GUIDES_INDEX_PAGE } from "@/lib/seo/static-pages";
import { isPageEnabled, isSaleEnabled } from "@/lib/settings";

export interface SeoPageAudit {
  path: string;
  title: string;
  metaDescription: string;
  h1?: string;
  status: "ok" | "needs_meta" | "missing_h1" | "thin_content";
  issues: string[];
}

// F-052 fix: this used to be the raw <title> string every static page's own
// `export const metadata` declares, checked against a 20-char minimum. But
// every one of those pages renders under the root layout's title template
// (src/app/layout.tsx: `"%s | DAAKYKA Apparels"`), so the real <title> is
// always longer than what was being measured — e.g. "/kids-wear" really
// renders "Kids Wear | DAAKYKA Apparels", not "Kids Wear". That mismatch is
// what produced 19 of 37 pages flagged "Title too short" even though every
// one of them was fine live. `renderedTitle` reproduces the template so the
// length check runs against what a shopper (and Google) actually sees.
// "/" is the one exception: the root layout's own default title has no
// template applied to it (see HOME_DEFAULT_TITLE below), and an admin
// override for "/" replaces the title outright rather than feeding it back
// through the template.
const TITLE_SUFFIX = ` | ${brand.name}`;

function renderedTitle(path: string, rawTitle: string): string {
  return path === "/" ? rawTitle : `${rawTitle}${TITLE_SUFFIX}`;
}

// The root layout's actual default title/description (src/app/layout.tsx)
// when no admin override exists for "/". Re-stated here rather than
// imported — layout.tsx doesn't export these as named bindings, and
// importing the whole root layout module (fonts, providers, the full
// generateMetadata side effects) into this lib file would be a much
// heavier and riskier dependency than two short strings that rarely
// change. F-052: this used to be `brand.description`, a different string
// the home page never actually rendered.
const HOME_DEFAULT_TITLE = "DAAKYKA Apparels | Quality Uniforms & Linens for Pan India";
const HOME_DEFAULT_DESCRIPTION =
  "Expertly designed, meticulously crafted. Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad, Pan India delivery.";

export const STATIC_SEO_PAGES: Omit<SeoPageAudit, "status" | "issues">[] = [
  { path: "/", title: HOME_DEFAULT_TITLE, metaDescription: HOME_DEFAULT_DESCRIPTION, h1: "Expertly Designed, Meticulously Crafted" },
  { path: "/shop", title: "Shop All Scrubs", metaDescription: "Browse premium medical scrubs with advanced filters for color, size, fabric technology, and price.", h1: "Shop All Scrubs" },
  { path: "/mix-and-match", title: "Mix & Match Builder", metaDescription: "Build your perfect scrub set with live preview, fabric selection, and personalization.", h1: "Create Your Perfect Fit" },
  { path: "/fabric-technology", title: "Fabric Technology", metaDescription: "Explore 4-way stretch, liquid repellent, anti-microbial, and sustainable fabric technologies.", h1: "The Science Behind The Scrub" },
  // F-052: /bulk-orders, /about, /contact and /guides take their title,
  // description and <h1> from src/lib/seo/static-pages.ts — the same constants
  // the pages render — so this list can't drift from them (it used to re-type
  // the strings, and claimed an <h1> those pages did not yet render). Each page
  // passes `titleAs="h1"`, which audit.test.ts checks against the page source.
  { path: "/bulk-orders", title: BULK_ORDERS_PAGE.title, metaDescription: BULK_ORDERS_PAGE.description, h1: BULK_ORDERS_PAGE.h1 },
  { path: "/for-hospitals", title: "For Hospitals", metaDescription: "Scrubs, patient gowns, staff uniforms, and hospital linens by Babaji Enterprises — Pan India delivery.", h1: "Uniforms & Linens for Hospitals" },
  { path: "/school-uniforms", title: "School Uniforms", metaDescription: "Shirts, tunics, trousers, skirts, blazers, and sportswear for schools by DAAKYKA Apparels.", h1: "School Uniforms" },
  { path: "/kids-wear", title: "Kids Wear", metaDescription: "Everyday kids' wear — T-shirts, joggers, frocks, co-ords, and hoodies from DAAKYKA Apparels.", h1: "Kids Wear" },
  { path: "/our-story", title: "Our Story", metaDescription: `${brand.name} by ${brand.legalName} — ${brand.tagline}. ${brand.description}`, h1: brand.tagline },
  { path: "/about", title: ABOUT_PAGE.title, metaDescription: ABOUT_PAGE.description, h1: ABOUT_PAGE.h1 },
  { path: "/contact", title: CONTACT_PAGE.title, metaDescription: CONTACT_PAGE.description, h1: CONTACT_PAGE.h1 },
  { path: "/blog", title: "Journal", metaDescription: "Style, fit, and fabric insights for healthcare professionals.", h1: "From Our Journal" },
  { path: "/guides", title: GUIDES_INDEX_PAGE.title, metaDescription: GUIDES_INDEX_PAGE.description, h1: GUIDES_INDEX_PAGE.h1 },
  { path: "/size-guide", title: "Size Guide", metaDescription: "Find your perfect scrub fit with DAAKYKA size guide.", h1: "Size Guide" },
];

const saleAuditEntry: Omit<SeoPageAudit, "status" | "issues"> = {
  path: "/sale",
  title: "Sale — DAAKYKA Apparels",
  metaDescription: "Discounted medical scrubs, uniforms, and apparel from DAAKYKA Apparels while stocks last.",
  h1: "Sale",
};

export function auditSeoPage(page: Omit<SeoPageAudit, "status" | "issues">): SeoPageAudit {
  const issues: string[] = [];
  let status: SeoPageAudit["status"] = "ok";

  if (page.metaDescription.length < 50) {
    issues.push("Meta description too short (< 50 chars)");
    status = "needs_meta";
  }
  if (page.metaDescription.length > 160) {
    issues.push("Meta description too long (> 160 chars)");
    status = "needs_meta";
  }
  if (!page.h1) {
    issues.push("Missing H1");
    status = "missing_h1";
  }
  // F-052 fix: check the length of the *rendered* title (with the root
  // layout's " | DAAKYKA Apparels" template applied), not the raw string
  // every page's own metadata declares — see renderedTitle's doc comment.
  if (renderedTitle(page.path, page.title).length < 20) {
    issues.push("Title too short");
    status = "needs_meta";
  }

  return { ...page, status, issues };
}

export async function getStaticSeoAudits(): Promise<SeoPageAudit[]> {
  const guidePages = seoLandingPages.map((page) => ({
    path: `/guides/${page.slug}`,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
  }));

  const [fabricTechEnabled, mixMatchEnabled, saleEnabled, liveOverrideByPath] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    isSaleEnabled(),
    // F-052 fix: only the paths in WIRED_SEO_PATHS (home, shop, bulk-orders,
    // about, contact, the guides index and each guide) have an admin override
    // (src/lib/seo/records.ts) that reaches the live <title>/<meta
    // description>. The audit used to always show the hardcoded default for
    // those, so /shop kept showing "needs meta" after an admin had already
    // fixed it with a live override.
    listLiveSeoOverrides(),
  ]);

  const pages = [...STATIC_SEO_PAGES, ...guidePages, ...(saleEnabled ? [saleAuditEntry] : [])]
    .filter((page) => {
      if (page.path === "/fabric-technology") return fabricTechEnabled;
      if (page.path === "/mix-and-match") return mixMatchEnabled;
      return true;
    })
    .map((page) => {
      const override = liveOverrideByPath.get(page.path);
      return override
        ? { ...page, title: override.title, metaDescription: override.metaDescription }
        : page;
    });

  return pages.map(auditSeoPage);
}

export function summarizeSeoAudits(pages: SeoPageAudit[]) {
  return {
    total: pages.length,
    ok: pages.filter((p) => p.status === "ok").length,
    needsMeta: pages.filter((p) => p.status === "needs_meta").length,
    missingH1: pages.filter((p) => p.status === "missing_h1").length,
    thinContent: pages.filter((p) => p.status === "thin_content").length,
  };
}
