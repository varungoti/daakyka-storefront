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
  /** ISO 8601 timestamp — release-hardening F-096: "Newest" sort needs the
   * row's real creation date, not just the admin-set `isNew` flag. Optional
   * so Shopify-mapped/legacy-seed products (which predate this column)
   * still type-check without populating it. */
  createdAt?: string;
  /** Admin-entered SEO title/description overrides (release-hardening
   * F-106) — `generateMetadata` prefers these over `name`/`description`
   * when set. */
  seoTitle?: string;
  seoDescription?: string;
  /** A short, hand-written teaser distinct from the full `description`
   * (release-hardening F-111) — used for the PDP's summary line above the
   * Description accordion instead of repeating the long description. */
  shortDescription?: string;
  // --- release-hardening F-311/F-195: India Legal Metrology / GST
  // declarations, admin-entered per product (schema columns added in
  // wave 1). Optional — the PDP and invoice fall back to store-wide
  // defaults (country of origin) or simply omit the line (net quantity,
  // HSN) when unset, rather than inventing a value. ---
  countryOfOrigin?: string;
  netQuantity?: string;
  hsnCode?: string;
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
  /** F-108: the stock ceiling this line was added against (DB-tracked
   * variants only — see AddToCartButton). Local-cart quantity changes
   * (another Add, the stepper in the cart drawer) are clamped to this so
   * the cart can never hold more than what was in stock at add time.
   * Undefined for a variant that doesn't track stock (Shopify/legacy
   * seed), which stays uncapped client-side as before. */
  maxQuantity?: number;
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
