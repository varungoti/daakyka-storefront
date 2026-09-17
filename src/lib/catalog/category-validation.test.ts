import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify, wouldCreateCategoryCycle } from "@/lib/catalog/category-validation";

describe("slugify", () => {
  it("lowercases and hyphenates a normal name", () => {
    assert.equal(slugify("Scrub Sets"), "scrub-sets");
  });

  it("strips punctuation and collapses repeated separators", () => {
    assert.equal(slugify("Lab Coats & Aprons!!"), "lab-coats-aprons");
    assert.equal(slugify("  School   Uniforms  "), "school-uniforms");
  });

  it("strips diacritics", () => {
    assert.equal(slugify("Café Uniforms"), "cafe-uniforms");
  });

  it("trims leading/trailing hyphens", () => {
    assert.equal(slugify("-Kids Wear-"), "kids-wear");
  });

  it("falls back to a placeholder when nothing alphanumeric survives", () => {
    assert.equal(slugify("!!!"), "category");
    assert.equal(slugify(""), "category");
  });

  it("caps length at 160 characters", () => {
    const long = "a".repeat(300);
    assert.ok(slugify(long).length <= 160);
  });
});

describe("wouldCreateCategoryCycle", () => {
  const tree = [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" },
    { id: "sibling", parentId: "root" },
  ];

  it("a category cannot be its own parent", () => {
    assert.equal(wouldCreateCategoryCycle("root", "root", tree), true);
  });

  it("a category cannot be moved under its own direct child", () => {
    assert.equal(wouldCreateCategoryCycle("root", "child", tree), true);
  });

  it("a category cannot be moved under its own grandchild", () => {
    assert.equal(wouldCreateCategoryCycle("root", "grandchild", tree), true);
  });

  it("moving a category under an unrelated node is allowed", () => {
    assert.equal(wouldCreateCategoryCycle("grandchild", "sibling", tree), false);
  });

  it("moving a leaf under its sibling is allowed (no cycle)", () => {
    assert.equal(wouldCreateCategoryCycle("child", "sibling", tree), false);
  });

  it("moving a top-level category to become a child of one of its own descendants is blocked", () => {
    assert.equal(wouldCreateCategoryCycle("child", "grandchild", tree), true);
  });

  it("treats a pre-existing malformed cycle in the input as unsafe rather than looping forever", () => {
    const broken = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    // "c" isn't part of the a<->b loop at all, but walking up from "a"
    // never terminates without the seen-node guard — once that guard
    // trips, the whole candidate chain is treated as unsafe (a cycle)
    // rather than the function looping forever.
    assert.equal(wouldCreateCategoryCycle("c", "a", broken), true);
    assert.equal(wouldCreateCategoryCycle("a", "b", broken), true);
  });
});
