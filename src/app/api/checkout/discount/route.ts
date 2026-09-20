import { NextResponse } from "next/server";
import { repriceLines } from "@/lib/orders/create-order";
import {
  DiscountAlreadyUsedError,
  DiscountExpiredError,
  DiscountInactiveError,
  DiscountMinSubtotalError,
  DiscountNotFoundError,
  DiscountNotStartedError,
  DiscountUsageLimitReachedError,
  resolveDiscount,
} from "@/lib/discounts";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { discountPreviewSchema } from "@/lib/validation/schemas";

/**
 * Release-hardening F7: the checkout page's "Have a discount code?" live
 * preview — lets the shopper see the code applied (or a clear invalid/
 * expired/min-subtotal message) before placing the order. NON-authoritative
 * and side-effect-free: nothing is reserved here (see
 * src/lib/discounts/index.ts's module doc comment — only
 * commitDiscountRedemption, called from createOrderFromCart/verify/webhook,
 * ever counts against a code's cap). The final POST /api/checkout call
 * re-validates and re-computes the discount from scratch server-side
 * regardless of what this endpoint returned.
 *
 * The subtotal is re-priced from the real cart via the same repriceLines()
 * createOrderFromCart uses — never trusts a client-computed subtotal —
 * so the previewed amount can't be inflated by a stale or tampered cart.
 */
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "checkout-discount", 20, 60_000);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = discountPreviewSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { items, code, email } = parsed.data;

  try {
    const lines = await repriceLines(items);
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const resolved = await resolveDiscount(code, subtotal, email ?? "");

    return NextResponse.json({
      code: resolved.code,
      type: resolved.type,
      value: resolved.value,
      amount: resolved.amount,
      subtotal,
    });
  } catch (error) {
    if (
      error instanceof DiscountNotFoundError ||
      error instanceof DiscountInactiveError ||
      error instanceof DiscountNotStartedError ||
      error instanceof DiscountExpiredError ||
      error instanceof DiscountMinSubtotalError ||
      error instanceof DiscountUsageLimitReachedError ||
      error instanceof DiscountAlreadyUsedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // A cart-repricing failure (empty/invalid/out-of-stock line) here just
    // means the preview can't be computed right now — the real error
    // surfaces to the shopper from the final checkout submission instead,
    // which re-runs the same repriceLines() check.
    return NextResponse.json({ error: "Could not validate this code right now" }, { status: 400 });
  }
}
