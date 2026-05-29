import { defaultCartLineImage } from "@/data/media/catalog";
import { isShopifyConfigured } from "@/lib/shopify/config";
import { shopifyFetch } from "@/lib/shopify/client";
import {
  ADD_TO_CART_MUTATION,
  CREATE_CART_MUTATION,
  GET_CART_QUERY,
  REMOVE_FROM_CART_MUTATION,
  UPDATE_CART_LINES_MUTATION,
} from "@/lib/shopify/queries";
import type { Cart, CartLine } from "@/lib/types";

interface ShopifyCartLine {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    price: { amount: string; currencyCode: string };
    product: {
      title: string;
      handle: string;
      featuredImage: { url: string; altText: string | null } | null;
    };
  };
}

interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    totalAmount: { amount: string; currencyCode: string };
  };
  lines: { edges: { node: ShopifyCartLine }[] };
}

function mapShopifyCart(cart: ShopifyCart): Cart {
  const lines: CartLine[] = cart.lines.edges.map(({ node }) => ({
    id: node.id,
    variantId: node.merchandise.id,
    productHandle: node.merchandise.product.handle,
    productTitle: node.merchandise.product.title,
    variantTitle: node.merchandise.title,
    quantity: node.quantity,
    price: Number(node.merchandise.price.amount),
    image: node.merchandise.product.featuredImage?.url ?? defaultCartLineImage,
  }));

  return {
    id: cart.id,
    lines,
    totalQuantity: cart.totalQuantity,
    subtotal: Number(cart.cost.totalAmount.amount),
    checkoutUrl: cart.checkoutUrl,
    currencyCode: cart.cost.totalAmount.currencyCode,
  };
}

export async function createShopifyCart(
  lines?: { merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartCreate: { cart: ShopifyCart | null; userErrors: { message: string }[] };
  }>({
    query: CREATE_CART_MUTATION,
    variables: {
      lines: lines?.map((line) => ({
        merchandiseId: line.merchandiseId,
        quantity: line.quantity,
      })),
    },
    cache: "no-store",
  });

  if (data.cartCreate.userErrors.length > 0) {
    throw new Error(data.cartCreate.userErrors[0].message);
  }

  if (!data.cartCreate.cart) {
    throw new Error("Failed to create cart");
  }

  return mapShopifyCart(data.cartCreate.cart);
}

export async function getShopifyCart(cartId: string): Promise<Cart | null> {
  const data = await shopifyFetch<{ cart: ShopifyCart | null }>({
    query: GET_CART_QUERY,
    variables: { cartId },
    cache: "no-store",
  });

  return data.cart ? mapShopifyCart(data.cart) : null;
}

export async function addToShopifyCart(
  cartId: string,
  merchandiseId: string,
  quantity: number,
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartLinesAdd: { cart: ShopifyCart | null; userErrors: { message: string }[] };
  }>({
    query: ADD_TO_CART_MUTATION,
    variables: {
      cartId,
      lines: [{ merchandiseId, quantity }],
    },
    cache: "no-store",
  });

  if (data.cartLinesAdd.userErrors.length > 0) {
    throw new Error(data.cartLinesAdd.userErrors[0].message);
  }

  if (!data.cartLinesAdd.cart) {
    throw new Error("Failed to add to cart");
  }

  return mapShopifyCart(data.cartLinesAdd.cart);
}

export async function updateShopifyCartLine(
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartLinesUpdate: { cart: ShopifyCart | null; userErrors: { message: string }[] };
  }>({
    query: UPDATE_CART_LINES_MUTATION,
    variables: {
      cartId,
      lines: [{ id: lineId, quantity }],
    },
    cache: "no-store",
  });

  if (data.cartLinesUpdate.userErrors.length > 0) {
    throw new Error(data.cartLinesUpdate.userErrors[0].message);
  }

  if (!data.cartLinesUpdate.cart) {
    throw new Error("Failed to update cart");
  }

  return mapShopifyCart(data.cartLinesUpdate.cart);
}

export async function removeFromShopifyCart(
  cartId: string,
  lineIds: string[],
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartLinesRemove: { cart: ShopifyCart | null; userErrors: { message: string }[] };
  }>({
    query: REMOVE_FROM_CART_MUTATION,
    variables: { cartId, lineIds },
    cache: "no-store",
  });

  if (data.cartLinesRemove.userErrors.length > 0) {
    throw new Error(data.cartLinesRemove.userErrors[0].message);
  }

  if (!data.cartLinesRemove.cart) {
    throw new Error("Failed to remove from cart");
  }

  return mapShopifyCart(data.cartLinesRemove.cart);
}

export function isShopifyCartMode(): boolean {
  return isShopifyConfigured();
}

export function createLocalCartId(): string {
  return `local-${crypto.randomUUID()}`;
}

export function buildLocalCart(lines: CartLine[]): Cart {
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );

  return {
    id: "local-cart",
    lines,
    totalQuantity,
    subtotal,
    currencyCode: "INR",
  };
}
