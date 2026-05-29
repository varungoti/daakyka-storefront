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
    const result = validateJsonLdObject(
      productJsonLd({
        id: "prod-1",
        handle: "classic-v-neck-top",
        name: "Classic V-Neck Top",
        description: "Premium scrub top",
        image: "https://example.com/image.jpg",
        price: 1899,
        available: true,
        rating: 4.8,
        reviewCount: 120,
      }),
    );
    assert.equal(result.valid, true);
    assert.equal(result.type, "Product");
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
