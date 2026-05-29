import { productImage } from "@/data/media/catalog";
import { BASE_CURRENCY, USD_TO_INR_RATE } from "@/lib/currency/config";

interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

interface ShopifyImage {
  url: string;
  altText: string | null;
}

interface ShopifyVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  price: ShopifyMoney;
  compareAtPrice: ShopifyMoney | null;
  selectedOptions: { name: string; value: string }[];
  image: ShopifyImage | null;
}

interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  tags: string[];
  productType: string;
  availableForSale: boolean;
  priceRange: {
    minVariantPrice: ShopifyMoney;
  };
  compareAtPriceRange: {
    minVariantPrice: ShopifyMoney;
  };
  featuredImage: ShopifyImage | null;
  images: { edges: { node: ShopifyImage }[] };
  options: { name: string; values: string[] }[];
  variants: { edges: { node: ShopifyVariant }[] };
}

const COLOR_HEX: Record<string, string> = {
  lilac: "#C4B5FD",
  purple: "#C4B5FD",
  navy: "#1E3A5F",
  sage: "#86A789",
  green: "#86A789",
  white: "#F5F5F4",
  charcoal: "#374151",
  teal: "#2DD4BF",
  plum: "#2A0E45",
  blush: "#F9A8D4",
  sand: "#D6C4A8",
};

import type {
  FabricTech,
  Product,
  ProductCategory,
  ProductColor,
  ProductVariant,
} from "@/lib/types";

function normalizeToInr(amount: number, currencyCode: string): number {
  if (currencyCode === BASE_CURRENCY) return amount;
  if (currencyCode === "USD") return Math.round(amount * USD_TO_INR_RATE);
  return amount;
}

function inferCategory(product: ShopifyProduct): ProductCategory {
  const type = product.productType.toLowerCase();
  const tags = product.tags.map((t) => t.toLowerCase());

  if (tags.includes("bespoke") || type.includes("bespoke")) return "bespoke";
  if (type.includes("top") || tags.includes("tops")) return "tops";
  if (type.includes("bottom") || type.includes("pant") || tags.includes("bottoms"))
    return "bottoms";
  if (type.includes("set") || tags.includes("sets")) return "sets";
  if (type.includes("jacket") || tags.includes("jackets")) return "jackets";
  if (type.includes("access") || tags.includes("accessories")) return "accessories";
  return "tops";
}

function inferFabricTech(tags: string[]): FabricTech[] {
  const normalized = tags.map((t) => t.toLowerCase());
  const tech: FabricTech[] = [];
  if (normalized.some((t) => t.includes("4-way") || t.includes("4 way")))
    tech.push("4-way-stretch");
  if (normalized.some((t) => t.includes("2-way") || t.includes("2 way")))
    tech.push("2-way-stretch");
  if (normalized.some((t) => t.includes("liquid") || t.includes("repellent")))
    tech.push("liquid-repellent");
  if (normalized.some((t) => t.includes("anti") || t.includes("microbial")))
    tech.push("anti-microbial");
  if (normalized.some((t) => t.includes("moisture") || t.includes("wicking")))
    tech.push("moisture-wicking");
  if (normalized.some((t) => t.includes("eco") || t.includes("sustainable")))
    tech.push("eco-flex");
  return tech.length > 0 ? tech : ["4-way-stretch"];
}

function colorFromName(name: string): ProductColor {
  const lower = name.toLowerCase();
  const hex =
    Object.entries(COLOR_HEX).find(([key]) => lower.includes(key))?.[1] ??
    "#C4B5FD";
  return { name, hex };
}

function inferBadge(tags: string[]): Product["badge"] {
  const normalized = tags.map((t) => t.toLowerCase());
  if (normalized.includes("best-seller") || normalized.includes("bestseller"))
    return "best-seller";
  if (normalized.includes("new")) return "new";
  return undefined;
}

function mapVariant(variant: ShopifyVariant): ProductVariant {
  return {
    id: variant.id,
    title: variant.title,
    price: normalizeToInr(
      Number(variant.price.amount),
      variant.price.currencyCode,
    ),
    compareAtPrice: variant.compareAtPrice
      ? normalizeToInr(
          Number(variant.compareAtPrice.amount),
          variant.price.currencyCode,
        )
      : undefined,
    available: variant.availableForSale,
    selectedOptions: variant.selectedOptions,
    image: variant.image?.url,
  };
}

export function mapShopifyProduct(product: ShopifyProduct): Product {
  const variants = product.variants.edges.map(({ node }) => mapVariant(node));
  const firstVariant = variants[0];
  const colorOption = product.options.find((o) =>
    o.name.toLowerCase().includes("color"),
  );
  const sizeOption = product.options.find((o) =>
    o.name.toLowerCase().includes("size"),
  );

  const colors: ProductColor[] = colorOption
    ? colorOption.values.map(colorFromName)
    : [colorFromName("Default")];

  const colorName =
    firstVariant?.selectedOptions.find((o) =>
      o.name.toLowerCase().includes("color"),
    )?.value ?? colors[0]?.name ?? "Default";

  const sizes = sizeOption?.values ?? ["S", "M", "L", "XL"];

  return {
    id: product.id,
    handle: product.handle,
    name: product.title,
    description: product.description,
    colorName,
    price: normalizeToInr(
      Number(product.priceRange.minVariantPrice.amount),
      product.priceRange.minVariantPrice.currencyCode,
    ),
    compareAtPrice: product.compareAtPriceRange.minVariantPrice.amount
      ? normalizeToInr(
          Number(product.compareAtPriceRange.minVariantPrice.amount),
          product.priceRange.minVariantPrice.currencyCode,
        )
      : undefined,
    rating: 4.8,
    reviewCount: 0,
    category: inferCategory(product),
    colors,
    sizes,
    fabricTech: inferFabricTech(product.tags),
    image:
      product.featuredImage?.url ??
      product.images.edges[0]?.node.url ??
      productImage(product.handle),
    images: product.images.edges.map(({ node }) => node.url),
    badge: inferBadge(product.tags),
    variants,
    defaultVariantId: firstVariant?.id,
    shopifyProductId: product.id,
    available: product.availableForSale,
  };
}

export type { ShopifyProduct };
