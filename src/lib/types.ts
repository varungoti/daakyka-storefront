export type FabricTech =
  | "4-way-stretch"
  | "2-way-stretch"
  | "liquid-repellent"
  | "anti-microbial"
  | "moisture-wicking"
  | "eco-flex";

export type ProductCategory =
  | "tops"
  | "bottoms"
  | "sets"
  | "jackets"
  | "accessories"
  | "bespoke";

export interface ProductColor {
  name: string;
  hex: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: number;
  compareAtPrice?: number;
  available: boolean;
  selectedOptions: { name: string; value: string }[];
  image?: string;
}

export interface Product {
  id: string;
  handle: string;
  name: string;
  description?: string;
  colorName: string;
  price: number;
  compareAtPrice?: number;
  rating: number;
  reviewCount: number;
  category: ProductCategory;
  colors: ProductColor[];
  sizes: string[];
  fabricTech: FabricTech[];
  image: string;
  images?: string[];
  badge?: "best-seller" | "new";
  gender?: "men" | "women" | "unisex";
  variants?: ProductVariant[];
  defaultVariantId?: string;
  shopifyProductId?: string;
  available?: boolean;
}

export interface CartLine {
  id: string;
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  price: number;
  image: string;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  totalQuantity: number;
  subtotal: number;
  checkoutUrl?: string;
  currencyCode?: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  name: string;
  title: string;
  rating: number;
  avatar: string;
}
