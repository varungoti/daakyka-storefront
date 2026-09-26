import { brand } from "@/data/brand";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com";

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
    sameAs: [brand.web.domain],
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
function toAbsoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${siteUrlBase()}${url.startsWith("/") ? "" : "/"}${url}`;
}

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
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description:
      product.description ??
      "Premium medical apparel engineered for healthcare professionals.",
    image: (product.images ?? [product.image]).map(toAbsoluteUrl),
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
      "@type": "Offer",
      priceCurrency: "INR",
      price: product.price,
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `${base}/products/${product.handle}`,
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
