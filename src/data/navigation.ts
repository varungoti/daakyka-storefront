import { brand } from "@/data/brand";

export const announcementItems = brand.announcementMessages;

// Phase C2: the header's main nav is now built from the DB category tree
// plus SiteSetting flags — see src/lib/navigation/get-navigation.ts. Fabric
// Tech and Mix & Match are hidden by default (admin toggle in
// /admin/site-controls) and are intentionally absent from that nav tree.
// When enabled they still appear in the footer, gated through
// isPageEnabled() — see src/lib/navigation/get-footer-links.ts (Phase C6),
// which replaced the old static `footerLinks` export that used to live
// here.

// The shop's Color, Size and Price facets are NOT defined here: they used to
// be fixed lists written for the seed catalogue ("Midnight Navy", XXS-5XL),
// which never matched a real product (F-015/F-095). They are derived from the
// live products by `deriveShopFacets` in src/lib/shop/filters.ts. Fabric
// Technology stays a fixed list because `fabricTech` is a fixed vocabulary
// (see `FabricTech`).
export const fabricFilters = [
  { id: "4-way-stretch", label: "4-Way Stretch" },
  { id: "liquid-repellent", label: "Liquid Repellent" },
  { id: "anti-microbial", label: "Anti Microbial" },
  { id: "moisture-wicking", label: "Moisture Wicking" },
  { id: "eco-flex", label: "EcoFlex™ Sustainable" },
];

// F-008 fix: `title`s here are always shown as-is, but the `description`s
// for "Free Shipping" (index 0) and "Easy Returns" (index 1) are just
// fallback text — TrustBar overrides both from real settings
// (`shipping.freeAbove` via CurrencyProvider, `returns.windowDays` via its
// own prop) so this can never drift from what checkout/the PDP actually
// do again, the way the old hard-coded "₹8,299" and "30-day" strings did.
// "Customer Support" used to claim "24/7 live support", which nothing in
// the admin could confirm or change — WhatsApp and phone support are the
// channels that actually exist (see src/data/brand.ts / the header/footer).
export const trustItems = [
  {
    title: "Free Shipping",
    description: "On qualifying orders",
  },
  {
    title: "Easy Returns",
    description: "Hassle-free returns",
  },
  {
    title: "Bulk Orders",
    description: "Special pricing for teams",
  },
  {
    title: "Secure Payments",
    description: "100% secure checkout",
  },
  {
    title: "Customer Support",
    description: "WhatsApp & phone support",
  },
];
