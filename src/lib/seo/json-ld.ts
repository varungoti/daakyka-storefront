import { brand } from "@/data/brand";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com";

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    legalName: brand.legalName,
    url: siteUrl,
    logo: `${siteUrl}/favicon.ico`,
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
    sku: product.id,
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
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: product.rating,
      reviewCount: product.reviewCount,
    },
  };
}
