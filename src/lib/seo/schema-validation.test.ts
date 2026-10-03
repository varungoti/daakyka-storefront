import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alt as ogImageAlt, size as ogImageSize } from "@/app/opengraph-image";
import {
  baseOpenGraph,
  breadcrumbJsonLd,
  DEFAULT_OG_IMAGE,
  organizationJsonLd,
  PLACEHOLDER_PRODUCT_IMAGE,
  productJsonLd,
  siteUrlBase,
  websiteJsonLd,
} from "@/lib/seo/json-ld";
import { validateJsonLdObject } from "@/lib/seo/schema-validation";

describe("JSON-LD schema validation", () => {
  it("validates organization schema", () => {
    const result = validateJsonLdObject(organizationJsonLd());
    assert.equal(result.valid, true);
    assert.equal(result.type, "Organization");
  });

  it("validates website schema", () => {
    const result = validateJsonLdObject(websiteJsonLd());
    assert.equal(result.valid, true);
  });

  it("validates product schema fixture", () => {
    const data = productJsonLd({
      id: "gid://shopify/Product/123456789",
      handle: "classic-v-neck-top",
      name: "Classic V-Neck Top",
      description: "Premium scrub top",
      image: "https://example.com/image.jpg",
      price: 1899,
      available: true,
      rating: 4.8,
      reviewCount: 120,
    });
    const result = validateJsonLdObject(data);
    assert.equal(result.valid, true);
    assert.equal(result.type, "Product");
    // Never the opaque Shopify GID — that isn't a real SKU.
    assert.equal(data.sku, "classic-v-neck-top");
    assert.ok("aggregateRating" in data);
  });

  it("omits aggregateRating when there are no real reviews", () => {
    const data = productJsonLd({
      id: "prod-1",
      handle: "classic-v-neck-top",
      name: "Classic V-Neck Top",
      image: "https://example.com/image.jpg",
      price: 1899,
      rating: 0,
      reviewCount: 0,
    });
    assert.equal(validateJsonLdObject(data).valid, true);
    assert.equal("aggregateRating" in data, false);
  });

  it("publishes only prices of purchasable variants", () => {
    const data = productJsonLd({
      id: "prod-priced",
      handle: "priced-scrubs",
      name: "Priced Scrubs",
      image: "https://example.com/image.jpg",
      price: 1000,
      rating: 0,
      reviewCount: 0,
      variants: [
        { price: 1500, available: true },
        { price: 1700, available: true },
        { price: 900, available: false },
      ],
    });
    assert.equal(data.offers.lowPrice, 1500);
    assert.equal(data.offers.highPrice, 1700);
  });

  it("validates breadcrumb schema", () => {
    const result = validateJsonLdObject(
      breadcrumbJsonLd([
        { name: "Home", url: "https://daakyka.com" },
        { name: "Shop", url: "https://daakyka.com/shop" },
      ]),
    );
    assert.equal(result.valid, true);
  });

  it("flags invalid product offers", () => {
    const result = validateJsonLdObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Test",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.includes("offers")));
  });
});

const BASE_PRODUCT = {
  id: "prod-1",
  handle: "classic-v-neck-top",
  name: "Classic V-Neck Top",
  image: "https://example.com/image.jpg",
  price: 1899,
  rating: 0,
  reviewCount: 0,
};

/**
 * release-hardening F-110/F-320: the PDP's structured data used to publish
 * the base price only, an SVG placeholder as the product image, and no
 * shipping or return-policy fields for Google's merchant listings.
 */
describe("productJsonLd merchant-listing fields (F-110, F-320)", () => {
  it("emits a single Offer when every purchasable variant prices the same", () => {
    const data = productJsonLd({
      ...BASE_PRODUCT,
      variants: [{ price: 1899, available: true }, { price: 1899, available: true }],
    });
    assert.equal(data.offers["@type"], "Offer");
    assert.equal(data.offers.price, 1899);
    assert.equal(validateJsonLdObject(data).valid, true);
  });

  it("emits an AggregateOffer low/high range when a variant overrides the base price", () => {
    const data = productJsonLd({
      ...BASE_PRODUCT,
      variants: [{ price: 1899, available: true }, { price: 1299, available: true }],
    });
    assert.equal(data.offers["@type"], "AggregateOffer");
    assert.equal(data.offers.lowPrice, 1299);
    assert.equal(data.offers.highPrice, 1899);
    assert.equal(data.offers.offerCount, 2);
    assert.equal(validateJsonLdObject(data).valid, true);
  });

  it("never publishes the SVG placeholder as the product image", () => {
    const placeholderOnly = productJsonLd({
      ...BASE_PRODUCT,
      image: PLACEHOLDER_PRODUCT_IMAGE,
      images: [PLACEHOLDER_PRODUCT_IMAGE],
    });
    assert.equal("image" in placeholderOnly, false);

    const mixed = productJsonLd({
      ...BASE_PRODUCT,
      images: [PLACEHOLDER_PRODUCT_IMAGE, "/cdn/media/real.webp"],
    });
    assert.deepEqual(mixed.image, [`${siteUrlBase()}/cdn/media/real.webp`]);
  });

  it("adds shipping details and a return policy from the shipping/returns settings", () => {
    const data = productJsonLd({
      ...BASE_PRODUCT,
      shipping: { flatRateInr: 99, freeAboveInr: 8000 },
      returnWindowDays: 30,
    });
    assert.deepEqual(data.offers.shippingDetails!.shippingRate, {
      "@type": "MonetaryAmount",
      value: 99,
      currency: "INR",
    });
    assert.equal(data.offers.shippingDetails!.shippingDestination.addressCountry, "IN");
    assert.equal(data.offers.hasMerchantReturnPolicy!.merchantReturnDays, 30);
    assert.equal(data.offers.hasMerchantReturnPolicy!.applicableCountry, "IN");
    assert.equal(
      data.offers.hasMerchantReturnPolicy!.returnPolicyCategory,
      "https://schema.org/MerchantReturnFiniteReturnWindow",
    );
  });

  it("advertises free shipping for a product that alone clears the free-shipping threshold", () => {
    const data = productJsonLd({
      ...BASE_PRODUCT,
      price: 8500,
      shipping: { flatRateInr: 99, freeAboveInr: 8000 },
    });
    assert.equal(data.offers.shippingDetails!.shippingRate.value, 0);
  });

  it("leaves shipping and return fields out when no settings are supplied", () => {
    const data = productJsonLd(BASE_PRODUCT);
    assert.equal("shippingDetails" in data.offers, false);
    assert.equal("hasMerchantReturnPolicy" in data.offers, false);
  });
});

describe("organizationJsonLd (F-155)", () => {
  it("does not publish the site's own URL as a sameAs social profile", () => {
    assert.equal("sameAs" in organizationJsonLd(), false);
  });

  it("adds a contactPoint only when a phone or email is supplied", () => {
    assert.equal("contactPoint" in organizationJsonLd(), false);
    const withContact = organizationJsonLd({ phone: "+91 95530 94251" });
    assert.equal(withContact.contactPoint?.[0].telephone, "+91 95530 94251");
  });
});

/**
 * release-hardening F-151/F-110: Next replaces a segment's whole `openGraph`
 * object when a page sets its own, so every such page has to restate
 * type/siteName/locale and the share image, plus the per-page og:url.
 */
describe("baseOpenGraph (F-151)", () => {
  it("carries the site name, locale, a self-referencing url and the default share image", () => {
    const og = baseOpenGraph("/returns");
    assert.equal(og.type, "website");
    assert.equal(og.siteName, "DAAKYKA Apparels");
    assert.equal(og.locale, "en_IN");
    assert.equal(og.url, "/returns");
    assert.deepEqual(og.images, [DEFAULT_OG_IMAGE]);
  });

  it("types blog posts as articles", () => {
    assert.equal(baseOpenGraph("/blog/some-post", "article").type, "article");
  });

  it("keeps the default share image in step with src/app/opengraph-image.tsx", () => {
    assert.equal(DEFAULT_OG_IMAGE.alt, ogImageAlt);
    assert.equal(DEFAULT_OG_IMAGE.width, ogImageSize.width);
    assert.equal(DEFAULT_OG_IMAGE.height, ogImageSize.height);
    assert.equal(DEFAULT_OG_IMAGE.url, "/opengraph-image");
  });
});
