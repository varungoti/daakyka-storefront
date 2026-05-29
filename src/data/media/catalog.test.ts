import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  daakykaMedia,
  imageWidths,
  productGallery,
  productImage,
  scrubMedia,
} from "@/data/media/catalog";
import { products } from "@/data/products";

function assertHttpsUrl(url: string) {
  assert.match(url, /^https:\/\//);
}

describe("media catalog", () => {
  it("exposes founder photos from daakyka.com", () => {
    assertHttpsUrl(daakykaMedia.founders.kamal);
    assertHttpsUrl(daakykaMedia.founders.dianeshree);
    assert.match(daakykaMedia.founders.kamal, /daakyka\.com/);
  });

  it("includes client logos for institutional trust strip", () => {
    assert.ok(daakykaMedia.clientLogos.length >= 10);
    for (const client of daakykaMedia.clientLogos) {
      assert.ok(client.name.length > 0);
      assertHttpsUrl(client.src);
    }
  });

  it("uses daakyka brand imagery for hero and institutional sections", () => {
    assert.match(daakykaMedia.productDesigns, /daakyka\.com\/images\/why\.jpg/);
    assert.ok(daakykaMedia.uniformShowcase.length >= 4);
    for (const url of daakykaMedia.uniformShowcase) {
      assert.match(url, /daakyka\.com/);
    }
  });

  it("returns scrub-focused product images", () => {
    for (const handle of products.map((product) => product.handle)) {
      const image = productImage(handle);
      assertHttpsUrl(image);
      assert.match(image, /(pexels|unsplash|daakyka|shopify)/);
    }
  });

  it("returns 3-image galleries for seed SKUs", () => {
    const gallery = productGallery("v-neck-top-lilac");
    assert.equal(gallery.length, 3);
    for (const image of gallery) {
      assertHttpsUrl(image);
      assert.match(image, new RegExp(`w=${imageWidths.gallery}`));
    }
  });

  it("uses card-width scrub media for product tiles", () => {
    assert.match(scrubMedia.vNeckLilac, new RegExp(`w=${imageWidths.card}`));
  });

  it("uses curated scrub media keys", () => {
    assert.ok(Object.keys(scrubMedia).length >= 10);
    assertHttpsUrl(scrubMedia.vNeckLilac);
  });
});
