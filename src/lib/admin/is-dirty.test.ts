import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDirty } from "@/lib/admin/is-dirty";

describe("isDirty", () => {
  it("is false for two structurally identical snapshots", () => {
    const snapshot = { name: "Scrub Set", price: 999, tags: ["scrubs", "unisex"] };
    assert.equal(isDirty({ ...snapshot }, snapshot), false);
  });

  it("is true when a scalar field changes", () => {
    const snapshot = { name: "Scrub Set", price: 999 };
    assert.equal(isDirty({ name: "Scrub Set", price: 1099 }, snapshot), true);
  });

  it("is true when an array field gains an entry", () => {
    const snapshot = { tags: ["scrubs"] };
    assert.equal(isDirty({ tags: ["scrubs", "new"] }, snapshot), true);
  });

  it("is true when a nested object field changes", () => {
    const snapshot = { variants: [{ size: "M", stock: 10 }] };
    assert.equal(isDirty({ variants: [{ size: "M", stock: 11 }] }, snapshot), true);
  });

  it("is false for two separately-constructed but equal object graphs", () => {
    const build = (stock: number) => ({
      name: "Scrub Set",
      variants: [{ size: "M", stock }],
    });
    assert.equal(isDirty(build(5), build(5)), false);
  });

  it("treats an empty-string field as distinct from an absent one", () => {
    assert.equal(isDirty({ note: "" }, {}), true);
  });
});
