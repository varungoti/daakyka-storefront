import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  sizeForAspect,
  type PromptPreset,
} from "@/lib/ai/prompt-presets";

const ALL_PRESETS: PromptPreset[] = [
  "product",
  "category-tile",
  "hero-banner",
  "hospital-scene",
  "school-scene",
  "kids-scene",
  "blog",
  "avatar",
  "how-to-measure",
];

describe("buildPrompt", () => {
  it("returns a non-empty prompt for every preset with no fields given", () => {
    for (const preset of ALL_PRESETS) {
      const prompt = buildPrompt(preset);
      assert.ok(typeof prompt === "string" && prompt.trim().length > 0, `${preset} produced an empty prompt`);
    }
  });

  it("returns a non-empty prompt for every preset with fields given", () => {
    for (const preset of ALL_PRESETS) {
      const prompt = buildPrompt(preset, {
        name: "Unisex Scrub Set",
        color: "ocean blue",
        category: "scrubs",
        gender: "unisex",
        fabric: "poly-cotton",
        subject: "a nurse and a doctor",
        notes: "front and back view",
      });
      assert.ok(prompt.trim().length > 0, `${preset} produced an empty prompt`);
    }
  });

  it("never mentions text, logos, or watermarks as desired", () => {
    for (const preset of ALL_PRESETS) {
      const prompt = buildPrompt(preset).toLowerCase();
      assert.ok(prompt.includes("no text"), `${preset} missing no-text guidance`);
      assert.ok(prompt.includes("no logos") || prompt.includes("no watermark"), preset);
    }
  });

  it("kids-scene and school-scene include non-identifiable, age-appropriate guidance", () => {
    for (const preset of ["kids-scene", "school-scene"] as const) {
      const prompt = buildPrompt(preset).toLowerCase();
      assert.ok(prompt.includes("non-identifiable"), `${preset} missing non-identifiable guidance`);
      assert.ok(prompt.includes("age-appropriate"), `${preset} missing age-appropriate guidance`);
      assert.ok(prompt.includes("no recognizable faces") || prompt.includes("no close-up"), preset);
    }
  });

  it("other presets do not carry the kids-safety guidance", () => {
    const prompt = buildPrompt("product").toLowerCase();
    assert.ok(!prompt.includes("non-identifiable"));
  });

  it("uses promptOverride-independent brand context for product/category/hero presets", () => {
    for (const preset of ["product", "category-tile", "hero-banner"] as const) {
      const prompt = buildPrompt(preset).toLowerCase();
      assert.ok(prompt.includes("daakyka"), `${preset} missing brand context`);
    }
  });

  it("falls back to sensible defaults when fields are omitted", () => {
    const prompt = buildPrompt("product", {});
    assert.ok(prompt.includes("a garment"));
  });

  it("incorporates provided fields into the product prompt", () => {
    const prompt = buildPrompt("product", { name: "Kids Hoodie", color: "plum" });
    assert.ok(prompt.includes("Kids Hoodie"));
    assert.ok(prompt.includes("plum"));
  });
});

describe("sizeForAspect", () => {
  it("maps every aspect to a supported GPT image size", () => {
    assert.equal(sizeForAspect("square"), "1024x1024");
    assert.equal(sizeForAspect("portrait"), "1024x1536");
    assert.equal(sizeForAspect("landscape"), "1536x1024");
  });
});
