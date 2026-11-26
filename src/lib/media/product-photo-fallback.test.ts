import assert from "node:assert/strict";
import { test } from "node:test";
import { isGeneratedProductPhoto, wasProductOptimizerRequest } from "./product-photo-fallback";

const product = "/cdn/media/product/2026/09/39b876ef-bc30-4fb8-8752-b8c3f7e60d9b.webp";
const origin = "https://shop.example";

test("only first-party generated product WebP paths are eligible", () => {
  assert.equal(isGeneratedProductPhoto(product), true);
  for (const other of [
    origin + product, "//shop.example" + product, product + "?v=2", product + "#cut",
    product.replace("/product/", "/review/"), product.replace(".webp", ".png"),
    product.replace("/09/", "/99/"), product.replace("/2026/", "/../"),
    product.replace("/09/", "/%2F/"), "/placeholder-product.svg", "/images/catalog.webp",
  ]) {
    assert.equal(isGeneratedProductPhoto(other), false, other);
  }
});

test("only the failed optimizer request for the current owned photo can retry", () => {
  const input = new URLSearchParams({ url: product, w: "640", q: "75" });
  const optimizer = "/_next/image?" + input;
  assert.equal(wasProductOptimizerRequest(optimizer, origin, product), true);
  assert.equal(wasProductOptimizerRequest(origin + optimizer, origin, product), true);
  assert.equal(wasProductOptimizerRequest("https://other.example" + optimizer, origin, product), false);
  assert.equal(wasProductOptimizerRequest(product, origin, product), false);
  assert.equal(wasProductOptimizerRequest(optimizer + "&url=" + encodeURIComponent(product), origin, product), false);
  assert.equal(wasProductOptimizerRequest(optimizer, origin, product.replace("39b876ef", "23a7f68e")), false);
});
