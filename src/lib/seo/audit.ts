import { brand } from "@/data/brand";
import { seoLandingPages } from "@/data/seo-landing-pages";
import { getSeoOverrideForPath } from "@/lib/seo/records";
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

const staticPages: Omit<SeoPageAudit, "status" | "issues">[] = [
  { path: "/", title: HOME_DEFAULT_TITLE, metaDescription: HOME_DEFAULT_DESCRIPTION, h1: "Expertly Designed, Meticulously Crafted" },
  { path: "/shop", title: "Shop All Scrubs", metaDescription: "Browse premium medical scrubs with advanced filters for color, size, fabric technology, and price.", h1: "Shop All Scrubs" },
  { path: "/mix-and-match", title: "Mix & Match Builder", metaDescription: "Build your perfect scrub set with live preview, fabric selection, and personalization.", h1: "Create Your Perfect Fit" },
  { path: "/fabric-technology", title: "Fabric Technology", metaDescription: "Explore 4-way stretch, liquid repellent, anti-microbial, and sustainable fabric technologies.", h1: "The Science Behind The Scrub" },
  // F-052: /about, /contact and /bulk-orders don't actually render an <h1>
  // — each uses <SectionHeading> directly with no `titleAs="h1"`, which
  // defaults to <h2> (confirmed by reading src/app/about/page.tsx,
  // src/app/contact/page.tsx and src/app/bulk-orders/page.tsx and their
  // shared src/components/ui/section-heading.tsx). The audit used to claim
  // an h1 for all three, hiding a real gap from the SEO Manager report.
  { path: "/bulk-orders", title: "Bulk Orders", metaDescription: "Hospital and institutional uniform quotes with logo embroidery and Pan India delivery." },
  { path: "/for-hospitals", title: "For Hospitals", metaDescription: "Scrubs, patient gowns, staff uniforms, and hospital linens by Babaji Enterprises — Pan India delivery.", h1: "Uniforms & Linens for Hospitals" },
  { path: "/school-uniforms", title: "School Uniforms", metaDescription: "Shirts, tunics, trousers, skirts, blazers, and sportswear for schools by DAAKYKA Apparels.", h1: "School Uniforms" },
  { path: "/kids-wear", title: "Kids Wear", metaDescription: "Everyday kids' wear — T-shirts, joggers, frocks, co-ords, and hoodies from DAAKYKA Apparels.", h1: "Kids Wear" },
  { path: "/our-story", title: "Our Story", metaDescription: `${brand.name} by ${brand.legalName} — ${brand.tagline}. ${brand.description}`, h1: brand.tagline },
  { path: "/about", title: "About Us", metaDescription: `${brand.name} by ${brand.legalName} — ${brand.tagline}.` },
  { path: "/contact", title: "Contact", metaDescription: `Contact ${brand.name} — ${brand.location.city}. Pan India institutional uniforms.` },
  { path: "/blog", title: "Journal", metaDescription: "Style, fit, and fabric insights for healthcare professionals.", h1: "From Our Journal" },
  { path: "/guides", title: "Medical Apparel Guides", metaDescription: "Buying guides, fabric science, and hospital uniform resources from DAAKYKA Apparels.", h1: "Medical Apparel Guides" },
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

  const [fabricTechEnabled, mixMatchEnabled, saleEnabled, homeOverride, shopOverride] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    isSaleEnabled(),
    // F-052 fix: "/" and "/shop" are the only paths whose admin override
    // (src/lib/seo/records.ts's getSeoOverrideForPath) actually reaches the
    // live <title>/<meta description> (see src/app/page.tsx and
    // src/app/shop/page.tsx). The audit used to always show the hardcoded
    // default for these two, so /shop kept showing "needs meta" after an
    // admin had already fixed it with a live override.
    getSeoOverrideForPath("/"),
    getSeoOverrideForPath("/shop"),
  ]);
  const liveOverrideByPath = new Map([
    ["/", homeOverride],
    ["/shop", shopOverride],
  ]);

  const pages = [...staticPages, ...guidePages, ...(saleEnabled ? [saleAuditEntry] : [])]
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
