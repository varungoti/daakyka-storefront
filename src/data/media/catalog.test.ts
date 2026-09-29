import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  blogMedia,
  categoryMedia,
  daakykaMedia,
  imageWidths,
  marketingMedia,
  productGallery,
  productImage,
  scrubMedia,
  testimonialAvatars,
  withImageWidth,
} from "@/data/media/catalog";
import { products } from "@/data/products";

function assertHttpsUrl(url: string) {
  assert.match(url, /^https:\/\//);
}

/** True for a same-origin static asset path (e.g. a local placeholder SVG),
 * as opposed to a remote CDN URL. */
function isLocalPath(url: string) {
  return url.startsWith("/");
}

describe("media catalog", () => {
  it("no longer hotlinks the unreachable daakyka.com domain anywhere in the catalog", () => {
    // daakyka.com is unreachable from this environment (see the doc
    // comment at the top of catalog.ts) — every exported catalog value
    // must be either a real reachable CDN (pexels/unsplash) or a local,
    // same-origin placeholder. Founder portraits and client logos aren't
    // in this module at all any more — see image-manifest.ts.
    const exported = { daakykaMedia, scrubMedia, marketingMedia, categoryMedia, blogMedia, testimonialAvatars };
    assert.ok(!JSON.stringify(exported).includes("daakyka.com"));
  });

  it("uses working editorial assets for uniform and manufacturing scenes", () => {
    for (const url of [
      daakykaMedia.productDesigns,
      daakykaMedia.schoolUniforms,
      daakykaMedia.institutionalShowcase,
    ]) {
      assertHttpsUrl(url);
      assert.match(url, /(pexels|unsplash)/);
      assert.ok(!isLocalPath(url), `expected a real photo, not a local placeholder path: ${url}`);
    }
    for (const url of [daakykaMedia.hospitalUniforms, marketingMedia.bespokeFeature, marketingMedia.shopFeatureBespoke]) {
      assert.match(url, /^\/images\/[\w-]+\.webp$/);
      assert.ok(existsSync(join(process.cwd(), "public", url.slice(1))), `${url} must exist in public/images`);
    }
    assert.ok(!JSON.stringify({ daakykaMedia, scrubMedia, marketingMedia, categoryMedia, blogMedia }).includes("5712513"),
      "removed Pexels source must not return to the media catalog");
  });

  it("withImageWidth appends a CDN width param to a remote URL", () => {
    const url = withImageWidth("https://images.pexels.com/photos/1/pexels-photo-1.jpeg", 800);
    assert.match(url, /w=800/);
  });

  it("withImageWidth leaves a local/static asset path untouched", () => {
    assert.equal(withImageWidth("/placeholder-scene.svg", 800), "/placeholder-scene.svg");
  });

  it("returns scrub-focused product images", () => {
    for (const handle of products.map((product) => product.handle)) {
      const image = productImage(handle);
      assertHttpsUrl(image);
      assert.match(image, /(pexels|unsplash)/);
    }
  });

  it("returns 3-image galleries for seed SKUs, remote or local placeholder", () => {
    const gallery = productGallery("v-neck-top-lilac");
    assert.equal(gallery.length, 3);
    for (const image of gallery) {
      assert.ok(
        /^https:\/\//.test(image) || isLocalPath(image),
        `unexpected image source: ${image}`,
      );
      if (/^https:\/\//.test(image)) {
        assert.match(image, new RegExp(`w=${imageWidths.gallery}`));
      }
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
