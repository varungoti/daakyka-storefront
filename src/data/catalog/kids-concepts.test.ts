import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kidsConcepts } from "./kids-concepts";
import { draftCategories, draftProducts } from "./draft-catalog";

describe("Kids Wear expansion concepts", () => {
  it("contains exactly twenty distinct designs under existing Kids Wear categories", () => {
    assert.equal(kidsConcepts.length, 20);
    const slugs = kidsConcepts.map((concept) => concept.slug);
    assert.equal(new Set(slugs).size, 20);
    const existing = new Set(draftProducts.map((product) => product.slug));
    const kidsCategories = new Set(draftCategories.filter((category) => category.section === "KIDS").map((category) => category.slug));
    for (const concept of kidsConcepts) {
      assert.ok(!existing.has(concept.slug), `${concept.slug} duplicates an existing product`);
      assert.ok(kidsCategories.has(concept.categorySlug), `${concept.slug} has no Kids Wear category`);
      assert.ok(concept.name && concept.color && concept.design);
    }
  });
});
