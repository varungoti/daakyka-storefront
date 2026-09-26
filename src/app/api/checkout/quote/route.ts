import { NextResponse } from "next/server";
import { z } from "zod";
import {
  EmptyCartError,
  InvalidVariantError,
  OutOfStockError,
  repriceLines,
} from "@/lib/orders/create-order";
import { getSetting } from "@/lib/settings";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { checkoutItemSchema } from "@/lib/validation/schemas";

/**
 * Checkout-page pricing preview (audit F-115 / F-116): a side-effect-free
 * "what will this actually cost" read for the cart the shopper currently
 * has in localStorage, so the checkout page can show a real Shipping and
 * Total instead of "calculated at the next step", and correct any line
 * whose price has drifted since it was added to the cart.
 *
 * Reuses repriceLines() — the same re-pricing/stock/status checks
 * POST /api/checkout and the discount preview already run — instead of a
 * second, drift-prone copy of that logic (see repriceLines's doc comment
 * in src/lib/orders/create-order.ts). Nothing here is ever authoritative:
 * the final POST /api/checkout submission re-prices and re-validates the
 * cart from scratch server-side regardless of what this endpoint returned.
 */
const checkoutQuoteSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Your cart is empty").max(50),
});

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "checkout-quote", 30, 60_000);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = checkoutQuoteSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const lines = await repriceLines(parsed.data.items);
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const [flatRate, freeAbove] = await Promise.all([
      getSetting("shipping.flatRate"),
      getSetting("shipping.freeAbove"),
    ]);
    // Same rule as createOrderFromCart (src/lib/orders/create-order.ts): the
    // free-shipping threshold is evaluated against the pre-discount
    // subtotal, so this preview and the real order can never disagree.
    const shipping = subtotal >= freeAbove ? 0 : flatRate;

    return NextResponse.json({
      lines: lines.map((line) => ({
        variantId: line.variantId,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
      })),
      subtotal,
      shipping,
      freeAbove,
      total: subtotal + shipping,
    });
  } catch (error) {
    if (error instanceof EmptyCartError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof OutOfStockError) {
      // F-121: `available` lets the cart drawer/checkout summary offer an
      // "Update qty to N" action instead of only naming the problem line.
      return NextResponse.json(
        { error: error.message, variantId: error.variantId, available: error.available },
        { status: 409 },
      );
    }
    if (error instanceof InvalidVariantError) {
      return NextResponse.json({ error: error.message, variantId: error.variantId }, { status: 400 });
    }
    console.error("[checkout/quote] failed to compute totals", error);
    return NextResponse.json({ error: "Could not calculate totals right now" }, { status: 500 });
  }
}
