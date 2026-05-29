import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveProductVariant } from "@/lib/mix-match/resolve-products";
import type { Product } from "@/lib/types";

const sampleProduct: Product = {
  id: "1",
  handle: "v-neck-top-lilac",
  name: "V-Neck Top",
  colorName: "Lilac Purple",
  price: 3999,
  rating: 4.9,
  reviewCount: 1,
  category: "tops",
  colors: [],
  sizes: ["M"],
  fabricTech: ["4-way-stretch"],
  image: "https://example.com/top.jpg",
  variants: [
    {
      id: "v-m-lilac",
      title: "M / Lilac Purple",
      price: 3999,
      available: true,
      selectedOptions: [
        { name: "Size", value: "M" },
        { name: "Color", value: "Lilac Purple" },
      ],
      image: "https://example.com/top-lilac.jpg",
    },
    {
      id: "v-m-navy",
      title: "M / Midnight Navy",
      price: 3999,
      available: true,
      selectedOptions: [
        { name: "Size", value: "M" },
        { name: "Color", value: "Midnight Navy" },
      ],
      image: "https://example.com/top-navy.jpg",
    },
  ],
};

describe("resolveProductVariant", () => {
  it("matches size and color when available", () => {
    const variant = resolveProductVariant(sampleProduct, "M", "Midnight Navy");
    assert.equal(variant?.id, "v-m-navy");
    assert.equal(variant?.image, "https://example.com/top-navy.jpg");
  });

  it("falls back to size-only match", () => {
    const variant = resolveProductVariant(sampleProduct, "M", "Unknown");
    assert.equal(variant?.id, "v-m-lilac");
  });
});
