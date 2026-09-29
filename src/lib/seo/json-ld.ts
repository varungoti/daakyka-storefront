import { brand } from "@/data/brand";
import { canonicalPath } from "@/lib/seo/canonical";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com";

export const SITE_NAME = "DAAKYKA Apparels";

/**
 * release-hardening F-151: the root layout's `openGraph` only carries
 * `type`/`siteName`/`locale` (title/description are deliberately absent —
 * see that file's doc comment). Next's metadata resolution merges
 * `openGraph` shallowly per segment, so a page that sets its *own*
 * `openGraph` object for any reason (a per-page `url`, a product image,
 * an article type) replaces the whole thing and silently drops
 * `siteName`/`locale`/`type` unless it re-states them. Every such
 * override should spread this instead of hand-repeating those three keys.
 */
export function baseOpenGraph<T extends "website" | "article" = "website">(path: string, type?: T) {
  return {
    // Generic (rather than a plain `"website" | "article"` parameter) so
    // `type` stays a narrowed literal in the returned object — a caller
    // spreading this into `{ ...baseOpenGraph(path, "article"), publishedTime,
    // authors }` (article-only OpenGraph fields) needs Metadata's `openGraph`
    // union to see `type: "article"`, not the widened union, or those extra
    // fields fail TypeScript's excess-property check.
    type: (type ?? "website") as T,
    siteName: SITE_NAME,
    locale: "en_IN",
    url: canonicalPath(path),
  };
}

/**
 * F-053: `address`/`phone`/`email` are optional overrides from the same
 * admin-editable `contact.*` settings the footer and /contact page already
 * render, so the Organization JSON-LD can't drift out of step with them
 * the way it used to (this used to always read the static brand.ts
 * address, which a Site Controls edit never reached). Left optional, and
 * defaulting to the brand.ts values when omitted, so the two existing
 * no-args call sites (the admin SEO preview, schema-validation.test.ts)
 * keep compiling and rendering exactly as before.
 */
export function organizationJsonLd(overrides?: { address?: string; phone?: string; email?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    legalName: brand.legalName,
    url: siteUrl,
    logo: `${siteUrl}/icon.svg`,
    description: brand.description,
    address: {
      "@type": "PostalAddress",
      streetAddress: overrides?.address ?? brand.location.addressLine,
      addressLocality: brand.location.city,
      addressRegion: brand.location.state,
      addressCountry: "IN",
    },
    areaServed: brand.location.serviceArea,
    // release-hardening F-155: this used to be `sameAs: [brand.web.domain]`
    // — the site's own URL, which Google's structured-data guidelines
    // treat as a self-reference, not the "same as" social-profile links
    // sameAs is for. There's no admin-editable social-profile setting yet
    // (see docs/LAUNCH_CHECKLIST.md), so per the release-hardening business
    // rule of hiding a line rather than inventing a value, this is omitted
    // until real Instagram/LinkedIn/etc URLs exist to publish.
    ...(overrides?.phone || overrides?.email
      ? {
          contactPoint: [
            {
              "@type": "ContactPoint",
              contactType: "customer service",
              areaServed: "IN",
              ...(overrides.phone ? { telephone: overrides.phone } : {}),
              ...(overrides.email ? { email: overrides.email } : {}),
            },
          ],
        }
      : {}),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: brand.name,
    url: siteUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/shop?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function siteUrlBase() {
  return siteUrl;
}

/**
 * Schema.org/Google Rich Results expect absolute image URLs (storefront-ux
 * F9) — this app's product images come back from `/cdn/media/...` (site-
 * relative) in DB-native mode. Resolves against the same site-URL base
 * already used for canonical/`og:image`, but leaves an already-absolute
 * URL (e.g. a legacy Shopify-hosted image) untouched instead of
 * double-prefixing it.
 */
export function toAbsoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${siteUrlBase()}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Matches src/lib/products/index.ts's own (unexported) constant of the same
// name — the fallback image for a product with zero real photos. Neither
// Google's structured-data image guidelines nor social unfurlers accept an
// SVG, so it's filtered out below rather than published (release-hardening
// F-110) instead of widening that module's public surface for one constant.
const PLACEHOLDER_PRODUCT_IMAGE = "/placeholder-product.svg";

export function productJsonLd(product: {
  name: string;
  description?: string;
  image: string;
  images?: string[];
  id: string;
  handle: string;
  price: number;
  available?: boolean;
  rating: number;
  reviewCount: number;
  // release-hardening F-110: variant prices (ProductVariant.price) that
  // differ from the base `price` above — an admin can set a per-size/colour
  // override — used to publish only the base price, so a shopper's actual
  // selected-variant price could disagree with what search results showed.
  // Optional so every existing caller (admin SEO preview, tests) keeps
  // compiling and behaving exactly as before.
  variants?: { price: number; available?: boolean }[];
  // release-hardening F-320: basic merchant-listing fields for Google
  // Merchant Center / Rich Results — both optional and both built from the
  // same admin-editable settings the PDP's shipping/returns copy already
  // reads (src/app/products/[handle]/page.tsx), so they can't drift out of
  // sync with what's shown to the shopper.
  shipping?: { flatRateInr: number };
  returnWindowDays?: number;
  // release-hardening F-311: India Legal Metrology declarations, optional
  // so every existing caller (admin SEO preview, tests) keeps compiling
  // unchanged. `manufacturer.address` is a single combined string (the
  // same shape brand.location.addressLine/contact.address already use for
  // the Organization address below) rather than a structured PostalAddress
  // — Schema.org accepts a plain string for Organization.address.
  countryOfOrigin?: string;
  material?: string;
  manufacturer?: { name: string; address?: string };
}) {
  const base = siteUrlBase();
  const inStock = product.available ?? true;
  const images = (product.images ?? [product.image])
    .filter((url) => url !== PLACEHOLDER_PRODUCT_IMAGE)
    .map(toAbsoluteUrl);

  // release-hardening F-110: emit an AggregateOffer (low/high price) when a
  // variant actually prices differently from the base product, so the
  // published price range matches what the size/colour picker can show —
  // a single Offer otherwise, unchanged from before this fix.
  const variantPrices = (product.variants ?? [])
    .filter((variant) => variant.available !== false)
    .map((variant) => variant.price)
    .filter((price) => price > 0);
  const allPrices = variantPrices.length > 0 ? variantPrices : [product.price];
  const lowPrice = Math.min(...allPrices);
  const highPrice = Math.max(...allPrices);
  const availability = inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const offers =
    lowPrice === highPrice
      ? {
          "@type": "Offer",
          priceCurrency: "INR",
          price: lowPrice,
          availability,
          url: `${base}/products/${product.handle}`,
        }
      : {
          "@type": "AggregateOffer",
          priceCurrency: "INR",
          lowPrice,
          highPrice,
          offerCount: allPrices.length,
          availability,
          url: `${base}/products/${product.handle}`,
        };

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description:
      product.description ??
      "Premium medical apparel engineered for healthcare professionals.",
    ...(images.length > 0 ? { image: images } : {}),
    // Not a real SKU (Shopify variant SKUs aren't queried yet) — the
    // handle is at least a stable, human-readable identifier, unlike
    // product.id, which is Shopify's opaque GID for Shopify-backed
    // products and would be a meaningless "SKU" to publish.
    sku: product.handle,
    brand: {
      "@type": "Brand",
      name: "DAAKYKA Apparels",
    },
    offers: {
      ...offers,
      ...(product.shipping
        ? {
            shippingDetails: {
              "@type": "OfferShippingDetails",
              shippingRate: {
                "@type": "MonetaryAmount",
                value: product.shipping.flatRateInr,
                currency: "INR",
              },
              shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
            },
          }
        : {}),
      // Matches the real policy on /returns: a finite window, read from
      // the same `returns.windowDays` setting; the customer covers return
      // shipping for a change-of-mind return (not a manufacturing defect).
      ...(product.returnWindowDays
        ? {
            hasMerchantReturnPolicy: {
              "@type": "MerchantReturnPolicy",
              applicableCountry: "IN",
              returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
              merchantReturnDays: product.returnWindowDays,
              returnFees: "https://schema.org/ReturnShippingFees",
            },
          }
        : {}),
    },
    ...(product.countryOfOrigin ? { countryOfOrigin: product.countryOfOrigin } : {}),
    ...(product.material ? { material: product.material } : {}),
    ...(product.manufacturer
      ? {
          manufacturer: {
            "@type": "Organization",
            name: product.manufacturer.name,
            ...(product.manufacturer.address ? { address: product.manufacturer.address } : {}),
          },
        }
      : {}),
    // Google's structured-data guidelines require aggregateRating to
    // reflect real reviews — omit it rather than publish a rating with
    // zero (or fabricated) reviewCount, which Rich Results treats as
    // invalid/spammy.
    ...(product.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.reviewCount,
          },
        }
      : {}),
  };
}
