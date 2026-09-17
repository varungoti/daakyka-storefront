import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  productJsonLd,
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
