export type FabricTech =
  | "4-way-stretch"
  | "2-way-stretch"
  | "liquid-repellent"
  | "anti-microbial"
  | "moisture-wicking"
  | "eco-flex";

/**
 * A category "slug" — historically a fixed union of the old seed
 * catalog's categories (tops/bottoms/sets/...), now widened to any
 * string so it can hold a real `Category.slug` from the database (Phase
 * B3). Existing literal usages ("tops", "bespoke", etc.) are still valid
 * strings, so this widening is source-compatible everywhere it's used.
 */
export type ProductCategory = string;

export interface ProductColor {
  name: string;
  hex: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: number;
  compareAtPrice?: number;
  available: boolean;
  selectedOptions: { name: string; value: string }[];
  image?: string;
  /** Stock on hand for this variant. Undefined for sources (Shopify, the
   * legacy seed data) that don't track it — only DB-backed variants
   * (Phase B3) populate this. */
  stock?: number;
  /** DB variant id / SKU-bearing size + colour, when available. */
  size?: string;
  color?: string;
  colorHex?: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
  /** Colour this image belongs to, for a colour-specific gallery. Absent
   * means "shown for every colour" (e.g. a shared placeholder). */
  color?: string;
}

export interface Product {
  id: string;
  handle: string;
  name: string;
  /** Always plain text (HTML tags stripped) — safe for the SEO/OpenGraph
   * meta description, JSON-LD, and any other non-HTML-rendering context.
   * See `descriptionHtml` for the rich-rendered version, and
   * src/lib/catalog/description-html.ts for how both are derived from the
   * one stored `Product.description` value (release-hardening F-12). */
  description?: string;
  /** Sanitized HTML, safe for `dangerouslySetInnerHTML` — used by the PDP's
   * Description accordion only. Empty when there's no description. */
  descriptionHtml?: string;
  colorName: string;
  price: number;
  compareAtPrice?: number;
  rating: number;
  reviewCount: number;
  category: ProductCategory;
  colors: ProductColor[];
  sizes: string[];
  fabricTech: FabricTech[];
  image: string;
  images?: ProductImage[];
  badge?: "best-seller" | "new";
  gender?: string;
  variants?: ProductVariant[];
  defaultVariantId?: string;
  shopifyProductId?: string;
  available?: boolean;
  // --- Phase B3: DB-backed catalog fields (all optional so existing
  // Shopify-mapped and legacy-seed products keep type-checking without
  // populating them) ---
  categorySlug?: string;
  categoryName?: string;
  section?: "HOSPITAL" | "SCHOOL" | "KIDS" | "GENERAL";
  onSale?: boolean;
  ratingAverage?: number;
  fabric?: string;
  care?: string;
  featured?: boolean;
  isNew?: boolean;
  tags?: string[];
}

export interface CartLine {
  id: string;
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  price: number;
  image: string;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  totalQuantity: number;
  subtotal: number;
  checkoutUrl?: string;
  currencyCode?: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  name: string;
  title: string;
  rating: number;
  avatar: string;
}
