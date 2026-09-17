import { brand } from "@/data/brand";

export const announcementItems = brand.announcementMessages;

// Phase C2: the header's main nav is now built from the DB category tree
// plus SiteSetting flags — see src/lib/navigation/get-navigation.ts. Fabric
// Tech and Mix & Match are hidden by default (admin toggle in
// /admin/site-controls) and are intentionally absent from that nav tree.
// When enabled they still appear in the footer (see footerLinks below),
// gated through isPageEnabled() at render time.

export const colorFilters = [
  { name: "Lilac Purple", hex: "#C4B5FD" },
  { name: "Midnight Navy", hex: "#1E3A5F" },
  { name: "Sage Green", hex: "#86A789" },
  { name: "Cloud White", hex: "#F5F5F4" },
  { name: "Charcoal", hex: "#374151" },
  { name: "Rose Blush", hex: "#F9A8D4" },
  { name: "Ocean Teal", hex: "#2DD4BF" },
  { name: "Warm Sand", hex: "#D6C4A8" },
];

export const sizeFilters = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
];

export const fabricFilters = [
  { id: "4-way-stretch", label: "4-Way Stretch" },
  { id: "liquid-repellent", label: "Liquid Repellent" },
  { id: "anti-microbial", label: "Anti Microbial" },
  { id: "moisture-wicking", label: "Moisture Wicking" },
  { id: "eco-flex", label: "EcoFlex™ Sustainable" },
];

export const trustItems = [
  {
    title: "Free Shipping",
    description: "On qualifying orders",
  },
  {
    title: "Easy Returns",
    description: "30-day return policy",
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
    description: "24/7 live support",
  },
];

export const footerLinks = {
  shop: [
    { label: "All Scrubs", href: "/shop" },
    { label: "Collections", href: "/collections" },
    { label: "For Hospitals", href: "/for-hospitals" },
    { label: "School Uniforms", href: "/school-uniforms" },
    { label: "Kids Wear", href: "/kids-wear" },
    { label: "Medical Scrubs", href: "/medical-scrubs" },
    { label: "Doctor Scrubs", href: "/doctor-scrubs" },
    { label: "Mix & Match", href: "/mix-and-match" },
  ],
  company: [
    { label: "About Us", href: "/about" },
    { label: "Our Story", href: "/our-story" },
    { label: "Guides", href: "/guides" },
    { label: "Fabric Technology", href: "/fabric-technology" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  support: [
    { label: "Contact", href: "/contact" },
    { label: "Size Guide", href: "/size-guide" },
    { label: "Shipping", href: "/shipping" },
    { label: "Returns", href: "/returns" },
    { label: "Bulk Orders", href: "/bulk-orders" },
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy-policy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Accessibility", href: "/accessibility" },
  ],
};
