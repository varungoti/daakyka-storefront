import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COLOR_PRESETS, findPresetColorHex, isCustomColor, SIZE_PRESETS, sizePresetKeys } from "@/lib/catalog/size-presets";

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
});
