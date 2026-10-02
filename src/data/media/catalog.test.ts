import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
import { isInternalMediaLabel } from "@/lib/media/public-alt";

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

/**
 * F-272: /shop/bespoke, /our-story and /shop used to show a grey "image"
 * placeholder icon (and the alts were admin slot labels). These pin that no
 * marketing image a shopper sees is the placeholder graphic, and that the
 * sections that used it describe their pictures.
 */
describe("marketing imagery is real, described artwork (F-272)", () => {
  const flatten = (value: unknown): string[] =>
    typeof value === "string" ? [value] : Object.values(value as object).flatMap(flatten);

  it("no catalog image points at a placeholder graphic", () => {
    for (const [group, urls] of Object.entries({ daakykaMedia, scrubMedia, marketingMedia, categoryMedia, blogMedia, testimonialAvatars })) {
      for (const url of flatten(urls)) {
        assert.ok(!/placeholder/i.test(url), `${group} still has a placeholder: ${url}`);
      }
    }
  });

  const SECTIONS = [
    "src/components/home/bespoke-section.tsx",
    "src/components/home/insights-strip.tsx",
    "src/components/shop/shop-feature-cards.tsx",
  ];

  it("the bespoke, 4-way-stretch and shop feature sections never reference a placeholder", () => {
    for (const file of SECTIONS) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.ok(!/placeholder/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${file} renders a placeholder`);
    }
  });

  it("their images carry a real description, not an admin slot label or a repeated heading", () => {
    for (const file of SECTIONS) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const match of source.matchAll(/\balt="([^"]+)"/g)) {
        assert.equal(isInternalMediaLabel(match[1]), false, `${file}: alt "${match[1]}" reads like a slot label`);
        assert.ok(match[1].trim().split(/\s+/).length >= 3, `${file}: alt "${match[1]}" is too terse to describe a picture`);
      }
    }
  });
});
