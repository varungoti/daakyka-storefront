import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHOP_METADATA, resolveShopMetadata } from "@/lib/seo/shop-metadata";

describe("shop metadata", () => {
  it("leads with Kids Wear in the default description", () => {
    assert.match(DEFAULT_SHOP_METADATA.description, /^Browse DAAKYKA kidswear,/);
  });
  it("replaces only the untouched scrub-only seed pair", () => {
    assert.deepEqual(resolveShopMetadata({
      title: "Shop All Scrubs",
      metaDescription: "Browse premium medical scrubs with filters for color, size, fabric technology, and price.",
    }), DEFAULT_SHOP_METADATA);
  });

  it("keeps an admin-edited record", () => {
    assert.deepEqual(resolveShopMetadata({
      title: "Hospital and School Collections",
      metaDescription: "Explore hospital apparel and school uniforms for institutions across India.",
    }), {
      title: "Hospital and School Collections",
      description: "Explore hospital apparel and school uniforms for institutions across India.",
    });
  });

  it("uses defaults for blank or absent overrides", () => {
    assert.deepEqual(resolveShopMetadata(null), DEFAULT_SHOP_METADATA);
    assert.deepEqual(resolveShopMetadata({ title: " ", metaDescription: " " }), DEFAULT_SHOP_METADATA);
  });
});
