import { brand } from "@/data/brand";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com";

export function organizationJsonLd() {
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
      streetAddress: brand.location.addressLine,
      addressLocality: brand.location.city,
      addressRegion: brand.location.state,
      addressCountry: "IN",
    },
    areaServed: brand.location.serviceArea,
    sameAs: [brand.web.domain],
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
    image: product.images ?? [product.image],
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
