import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_MANIFEST,
  blogPostImageSlot,
  categoryImageSlot,
} from "@/data/media/image-manifest";
import { isInternalMediaLabel, publicImageAlt } from "@/lib/media/public-alt";

/**
 * release-hardening audit F-087: generated media assets store the manifest
 * slot label as their alt ("Contact — Banner", "Homepage Band — For
 * Hospitals"), which a screen reader then announced as the photo's
 * description.
 */
describe("isInternalMediaLabel", () => {
  it("recognises every label the image manifest can produce, so a new group can't slip through", () => {
    for (const entry of IMAGE_MANIFEST) {
      assert.ok(isInternalMediaLabel(entry.label), `not recognised: ${entry.label}`);
    }
    assert.ok(isInternalMediaLabel(categoryImageSlot({ slug: "scrub-sets", name: "Scrub Sets" }).label));
    assert.ok(isInternalMediaLabel(blogPostImageSlot({ slug: "x", title: "How to Wash Scrubs" }).label));
  });

  it("recognises the labels the audit found on the live homepage", () => {
    for (const label of [
      "Contact — Banner",
      "Homepage Band — For Hospitals",
      "Homepage Tile — For Hospitals",
      "Homepage Hero — Slide 2",
      "Category — Scrub Sets",
    ]) {
      assert.ok(isInternalMediaLabel(label), label);
    }
  });

  it("leaves real descriptive alt text alone", () => {
    for (const alt of [
      "Healthcare team in DAAKYKA scrubs",
      "Nurse wearing a lilac scrub set",
      "Contact lens case on a shelf",
      "Kids Wear — navy school uniform", // a real description that merely uses a dash
      "Category of scrubs for every department",
    ]) {
      assert.equal(isInternalMediaLabel(alt), false, alt);
    }
  });
});

describe("publicImageAlt", () => {
  it("returns the asset's own alt when it is real text", () => {
    assert.equal(publicImageAlt("  Surgeon in teal scrubs "), "Surgeon in teal scrubs");
  });

  it("returns the fallback (default: empty = decorative) for an internal label", () => {
    assert.equal(publicImageAlt("Homepage Hero — Slide 2"), "");
    assert.equal(publicImageAlt("Category — Scrub Sets", "Scrub Sets"), "Scrub Sets");
  });

  it("returns the fallback for a missing or blank alt", () => {
    assert.equal(publicImageAlt(null), "");
    assert.equal(publicImageAlt(undefined, "Fallback"), "Fallback");
    assert.equal(publicImageAlt("   ", "Fallback"), "Fallback");
  });
});
