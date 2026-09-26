import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_PRESETS,
  colorPresetIndex,
  compareSizes,
  findPresetColorHex,
  isCustomColor,
  SIZE_PRESETS,
  sizePresetKeys,
} from "@/lib/catalog/size-presets";

describe("SIZE_PRESETS", () => {
  it("has the expected adult scrub range", () => {
    assert.deepEqual(SIZE_PRESETS.adultScrubs, ["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
  });

  it("has the expected kids age range", () => {
    assert.deepEqual(SIZE_PRESETS.kidsAge, ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y", "12-14Y"]);
  });

  it("has the expected school chest range (even numbers 20-44)", () => {
    assert.deepEqual(SIZE_PRESETS.schoolChest, ["20", "22", "24", "26", "28", "30", "32", "34", "36", "38", "40", "42", "44"]);
  });

  it("has the expected linen sizes", () => {
    assert.deepEqual(SIZE_PRESETS.linens, ["Single", "Double", "King"]);
  });

  it("every preset is non-empty and every key is present", () => {
    for (const key of sizePresetKeys) {
      assert.ok(SIZE_PRESETS[key].length > 0, `${key} should not be empty`);
    }
  });
});

describe("COLOR_PRESETS", () => {
  it("every color has a valid 6-digit hex", () => {
    for (const color of COLOR_PRESETS) {
      assert.match(color.hex, /^#[0-9A-Fa-f]{6}$/, `${color.name} has an invalid hex`);
    }
  });

  it("has no duplicate color names", () => {
    const names = COLOR_PRESETS.map((c) => c.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });

  it("findPresetColorHex looks up case-insensitively", () => {
    assert.equal(findPresetColorHex("navy"), "#1E3A5F");
    assert.equal(findPresetColorHex("NAVY"), "#1E3A5F");
    assert.equal(findPresetColorHex("Not A Color"), undefined);
  });

  it("isCustomColor is false for a preset color and true otherwise", () => {
    assert.equal(isCustomColor("Navy"), false);
    assert.equal(isCustomColor("Turquoise"), true);
  });

  it("colorPresetIndex looks up case-insensitively and returns undefined for a custom color", () => {
    assert.equal(colorPresetIndex("Navy"), 0);
    assert.equal(colorPresetIndex("navy"), 0);
    assert.equal(colorPresetIndex("Turquoise"), undefined);
  });
});

// release-hardening audit F-024: sizes/colours used to come out in raw
// database row order ("2XL L M S XL", 2XL pre-selected) — compareSizes is
// the shared ordering every storefront read path now sorts through.
describe("compareSizes", () => {
  it("sorts adult scrub sizes into the merchant's XS-3XL order", () => {
    const sizes = ["2XL", "L", "M", "S", "XL"];
    assert.deepEqual([...sizes].sort(compareSizes), ["S", "M", "L", "XL", "2XL"]);
  });

  it("sorts kids age sizes numerically, not alphabetically", () => {
    const sizes = ["10-11Y", "2-3Y", "4-5Y"];
    assert.deepEqual([...sizes].sort(compareSizes), ["2-3Y", "4-5Y", "10-11Y"]);
  });

  it("sorts numeric school-chest sizes numerically", () => {
    const sizes = ["32", "28", "24"];
    assert.deepEqual([...sizes].sort(compareSizes), ["24", "28", "32"]);
  });

  it("sorts linen sizes Single/Double/King", () => {
    const sizes = ["King", "Double", "Single"];
    assert.deepEqual([...sizes].sort(compareSizes), ["Single", "Double", "King"]);
  });

  it("normalizes XXL/XXXL onto this catalogue's 2XL/3XL rank", () => {
    assert.equal(compareSizes("XXL", "2XL") === 0, true);
    assert.ok(compareSizes("XL", "XXL") < 0);
  });

  it("falls back to a stable, numeric-aware order for sizes outside every preset", () => {
    const sizes = ["Free Size", "One Size"];
    assert.deepEqual([...sizes].sort(compareSizes), ["Free Size", "One Size"]);
  });

  it("puts every known preset size ahead of an unknown size", () => {
    const sizes = ["Free Size", "M"];
    assert.deepEqual([...sizes].sort(compareSizes), ["M", "Free Size"]);
  });
});
