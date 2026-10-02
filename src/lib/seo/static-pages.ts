import { brand } from "@/data/brand";

/**
 * F-052: the title, description and <h1> of the storefront's lead/brand pages
 * (/bulk-orders, /about, /contact, /guides), defined once. Each page builds
 * its metadata from these (and an admin override from /admin/seo is laid over
 * them — see src/lib/seo/records.ts), and the SEO audit
 * (src/lib/seo/audit.ts) reads the same constants — the audit used to
 * re-type every string by hand, and the copies had drifted from what the
 * pages really rendered.
 *
 * `title` is the bare page title; the root layout's "%s | DAAKYKA Apparels"
 * template adds the brand suffix.
 */
export const BULK_ORDERS_PAGE = {
  title: "Bulk Orders",
  description:
    "Bulk uniform enquiries for hospitals, schools, sports teams and corporate offices — DAAKYKA Apparels, Pan India.",
  h1: "Uniforms for Institutions & Teams",
} as const;

export const ABOUT_PAGE = {
  title: "About Us",
  description: `${brand.name} by ${brand.legalName} — ${brand.tagline}. ${brand.subtagline}.`,
  h1: `${brand.tagline}. ${brand.subtagline}.`,
} as const;

export const CONTACT_PAGE = {
  title: "Contact",
  description: `Contact ${brand.name} — ${brand.legalName}, ${brand.location.city}. Pan India institutional uniforms and medical apparel.`,
  h1: "Contact DAAKYKA",
} as const;

export const GUIDES_INDEX_PAGE = {
  title: "Medical Scrubs Guides",
  description:
    "Buying guides, fabric science, and hospital uniform resources from DAAKYKA Apparels — Pan India medical apparel experts.",
  h1: "Medical Apparel Guides",
} as const;
