import { productGallery, productImage } from "@/data/media/catalog";
import type { Product } from "@/lib/types";

function withVariants(product: Product): Product {
  const defaultVariantId = `seed-${product.id}-m`;
  const gallery = productGallery(product.handle);
  return {
    ...product,
    available: true,
    defaultVariantId,
    images: gallery,
    variants: product.sizes.map((size) => ({
      id: `seed-${product.id}-${size.toLowerCase()}`,
      title: `${size} / ${product.colorName}`,
      price: product.price,
      available: true,
      selectedOptions: [
        { name: "Size", value: size },
        { name: "Color", value: product.colorName },
      ],
      image: product.image,
    })),
  };
}

const rawProducts: Product[] = [
  {
    id: "1",
    handle: "v-neck-top-lilac",
    name: "V-Neck Top",
    colorName: "Lilac Purple",
    price: 3999,
    rating: 4.9,
    reviewCount: 128,
    category: "tops",
    colors: [
      { name: "Lilac Purple", hex: "#C4B5FD" },
      { name: "Midnight Navy", hex: "#1E3A5F" },
      { name: "Sage Green", hex: "#86A789" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabricTech: ["4-way-stretch", "anti-microbial"],
    image: productImage("v-neck-top-lilac"),
    badge: "best-seller",
    gender: "women",
  },
  {
    id: "2",
    handle: "jogger-pants-navy",
    name: "Jogger Pants",
    colorName: "Midnight Navy",
    price: 4499,
    rating: 4.8,
    reviewCount: 96,
    category: "bottoms",
    colors: [
      { name: "Midnight Navy", hex: "#1E3A5F" },
      { name: "Charcoal", hex: "#374151" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabricTech: ["4-way-stretch", "liquid-repellent"],
    image: productImage("jogger-pants-navy"),
    gender: "men",
  },
  {
    id: "3",
    handle: "mandarin-collar-sage",
    name: "Mandarin Collar Top",
    colorName: "Sage Green",
    price: 4299,
    rating: 4.9,
    reviewCount: 74,
    category: "tops",
    colors: [
      { name: "Sage Green", hex: "#86A789" },
      { name: "Cloud White", hex: "#F5F5F4" },
    ],
    sizes: ["XS", "S", "M", "L", "XL"],
    fabricTech: ["4-way-stretch", "moisture-wicking"],
    image: productImage("mandarin-collar-sage"),
    badge: "new",
    gender: "women",
  },
  {
    id: "4",
    handle: "straight-pants-charcoal",
    name: "Straight Pants",
    colorName: "Charcoal",
    price: 4199,
    rating: 4.7,
    reviewCount: 62,
    category: "bottoms",
    colors: [
      { name: "Charcoal", hex: "#374151" },
      { name: "Midnight Navy", hex: "#1E3A5F" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    fabricTech: ["2-way-stretch", "anti-microbial"],
    image: productImage("straight-pants-charcoal"),
    gender: "unisex",
  },
  {
    id: "5",
    handle: "round-neck-white",
    name: "Round Neck Top",
    colorName: "Cloud White",
    price: 3799,
    rating: 4.8,
    reviewCount: 88,
    category: "tops",
    colors: [
      { name: "Cloud White", hex: "#F5F5F4" },
      { name: "Lilac Purple", hex: "#C4B5FD" },
    ],
    sizes: ["XS", "S", "M", "L", "XL"],
    fabricTech: ["4-way-stretch", "eco-flex"],
    image: productImage("round-neck-white"),
    gender: "women",
  },
  {
    id: "6",
    handle: "cargo-pants-teal",
    name: "Cargo Pants",
    colorName: "Ocean Teal",
    price: 4649,
    rating: 4.9,
    reviewCount: 51,
    category: "bottoms",
    colors: [
      { name: "Ocean Teal", hex: "#2DD4BF" },
      { name: "Charcoal", hex: "#374151" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL"],
    fabricTech: ["4-way-stretch", "liquid-repellent"],
    image: productImage("cargo-pants-teal"),
    gender: "men",
  },
  {
    id: "7",
    handle: "zip-neck-lilac",
    name: "Zip-Neck Top",
    colorName: "Lilac Purple",
    price: 4499,
    rating: 4.8,
    reviewCount: 43,
    category: "tops",
    colors: [
      { name: "Lilac Purple", hex: "#C4B5FD" },
      { name: "Rose Blush", hex: "#F9A8D4" },
    ],
    sizes: ["S", "M", "L", "XL"],
    fabricTech: ["4-way-stretch", "moisture-wicking"],
    image: productImage("zip-neck-lilac"),
    gender: "unisex",
  },
  {
    id: "8",
    handle: "bespoke-plum-set",
    name: "Bespoke Plum Set",
    colorName: "Premium Plum",
    price: 10499,
    rating: 5.0,
    reviewCount: 24,
    category: "bespoke",
    colors: [{ name: "Premium Plum", hex: "#2A0E45" }],
    sizes: ["S", "M", "L", "XL"],
    fabricTech: ["4-way-stretch", "liquid-repellent", "eco-flex"],
    image: productImage("bespoke-plum-set"),
    badge: "new",
    gender: "women",
  },
];

export const products: Product[] = rawProducts.map(withVariants);

export const bestSellers = products.filter(
  (p) => p.badge === "best-seller" || p.rating >= 4.8,
).slice(0, 4);

export function getProductsByCategory(category?: string) {
  if (!category) return products;
  return products.filter((p) => p.category === category);
}
