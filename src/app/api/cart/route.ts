import { NextResponse } from "next/server";
import {
  addToShopifyCart,
  createShopifyCart,
  getShopifyCart,
  isShopifyCartMode,
  removeFromShopifyCart,
  updateShopifyCartLine,
} from "@/lib/cart/service";
import { readJsonBody } from "@/lib/security/parse-json-body";

function cartDegradedResponse(error: unknown) {
  return NextResponse.json({
    mode: "degraded",
    fallback: "local",
    error: error instanceof Error ? error.message : "Shopify cart unavailable",
  });
}

export async function GET(request: Request) {
  if (!isShopifyCartMode()) {
    return NextResponse.json({ mode: "local" });
  }

  const { searchParams } = new URL(request.url);
  const cartId = searchParams.get("cartId");

  if (!cartId) {
    return NextResponse.json({ error: "cartId required" }, { status: 400 });
  }

  try {
    const cart = await getShopifyCart(cartId);
    return NextResponse.json({ cart, mode: "shopify" });
  } catch (error) {
    return cartDegradedResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isShopifyCartMode()) {
    return NextResponse.json({ mode: "local" });
  }

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { action, cartId, merchandiseId, quantity, lineId, lineIds } = bodyResult.data as {
      action?: string;
      cartId?: string;
      merchandiseId?: string;
      quantity?: number;
      lineId?: string;
      lineIds?: string[];
    };

    switch (action) {
      case "create": {
        const cart = await createShopifyCart(
          merchandiseId
            ? [{ merchandiseId, quantity: quantity ?? 1 }]
            : undefined,
        );
        return NextResponse.json({ cart, mode: "shopify" });
      }
      case "add": {
        if (!cartId || !merchandiseId) {
          return NextResponse.json({ error: "Missing cart fields" }, { status: 400 });
        }
        const cart = await addToShopifyCart(cartId, merchandiseId, quantity ?? 1);
        return NextResponse.json({ cart, mode: "shopify" });
      }
      case "update": {
        if (!cartId || !lineId) {
          return NextResponse.json({ error: "Missing update fields" }, { status: 400 });
        }
        const cart = await updateShopifyCartLine(cartId, lineId, quantity ?? 1);
        return NextResponse.json({ cart, mode: "shopify" });
      }
      case "remove": {
        if (!cartId || !lineIds?.length) {
          return NextResponse.json({ error: "Missing remove fields" }, { status: 400 });
        }
        const cart = await removeFromShopifyCart(cartId, lineIds);
        return NextResponse.json({ cart, mode: "shopify" });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return cartDegradedResponse(error);
  }
}
