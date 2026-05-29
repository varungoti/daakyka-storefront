import { brand } from "@/data/brand";
import { seoLandingPages } from "@/data/seo-landing-pages";

export interface SeoPageAudit {
  path: string;
  title: string;
  metaDescription: string;
  h1?: string;
  status: "ok" | "needs_meta" | "missing_h1" | "thin_content";
  issues: string[];
}

const staticPages: Omit<SeoPageAudit, "status" | "issues">[] = [
  { path: "/", title: "DAAKYKA Apparels | Quality Uniforms & Linens for Pan India", metaDescription: brand.description, h1: "Expertly Designed, Meticulously Crafted" },
  { path: "/shop", title: "Shop All Scrubs", metaDescription: "Browse premium medical scrubs with advanced filters for color, size, fabric technology, and price.", h1: "Shop All Scrubs" },
  { path: "/mix-and-match", title: "Mix & Match Builder", metaDescription: "Build your perfect scrub set with live preview, fabric selection, and personalization.", h1: "Create Your Perfect Fit" },
  { path: "/fabric-technology", title: "Fabric Technology", metaDescription: "Explore 4-way stretch, liquid repellent, anti-microbial, and sustainable fabric technologies.", h1: "The Science Behind The Scrub" },
  { path: "/bulk-orders", title: "Bulk Orders", metaDescription: "Hospital and institutional uniform quotes with logo embroidery and Pan India delivery.", h1: "Uniforms for Healthcare Teams" },
  { path: "/institutional", title: "Institutional Solutions", metaDescription: "Hospital linens, school uniforms, sports kits, and corporate wear by Babaji Enterprises.", h1: "Uniforms & Linens for Every Sector" },
  { path: "/about", title: "About Us", metaDescription: `${brand.name} by ${brand.legalName} — ${brand.tagline}.`, h1: brand.tagline },
  { path: "/contact", title: "Contact", metaDescription: `Contact ${brand.name} — ${brand.location.city}. Pan India institutional uniforms.`, h1: "Contact DAAKYKA" },
  { path: "/blog", title: "Journal", metaDescription: "Style, fit, and fabric insights for healthcare professionals.", h1: "From Our Journal" },
  { path: "/guides", title: "Medical Apparel Guides", metaDescription: "Buying guides, fabric science, and hospital uniform resources from DAAKYKA Apparels.", h1: "Medical Apparel Guides" },
  { path: "/size-guide", title: "Size Guide", metaDescription: "Find your perfect scrub fit with DAAKYKA size guide.", h1: "Size Guide" },
];

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
  if (page.title.length < 20) {
    issues.push("Title too short");
    status = "needs_meta";
  }

  return { ...page, status, issues };
}

export function getStaticSeoAudits(): SeoPageAudit[] {
  const guidePages = seoLandingPages.map((page) => ({
    path: `/guides/${page.slug}`,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
  }));

  return [...staticPages, ...guidePages].map(auditSeoPage);
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
