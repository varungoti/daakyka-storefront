import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";

/**
 * Release-hardening Finding B: an IP-independent abuse guard for the
 * unpaid "order request" checkout fallback.
 *
 * POST /api/checkout falls back to paymentMethod=ORDER_REQUEST whenever
 * Razorpay isn't configured (the current production state — see
 * src/app/api/checkout/route.ts). That path creates a real `Order` and
 * decrements real stock (src/lib/orders/create-order.ts) with no payment
 * step at all — an intentional manual-invoicing path for institutional
 * buyers, but with only the route's IP rate limit standing between it and
 * a script that drains the catalogue for free. IP alone isn't enough: it's
 * spoofable via X-Forwarded-For (a separate fix, tracked elsewhere this
 * round) and trivially rotated anyway.
 *
 * This throttles on the *identity the order is placed under* instead —
 * normalised email and phone, each checked independently against the
 * existing DB-backed limiter (src/lib/security/rate-limit.ts's
 * checkRateLimit, called here with a dedicated key namespace; that file is
 * owned by another workstream this round and is not modified here).
 * Forging a new IP is free; forging a new *working* email and phone for
 * every batch of orders is a meaningfully higher bar, and this combines
 * with — rather than replaces — the route's existing IP limit and the
 * header-spoof fix landing separately.
 *
 * Limits: a real institutional buyer placing a manual/unpaid order
 * request might resubmit a couple of times (a typo, a network hiccup, a
 * second department's cart) but essentially never more than a handful in
 * an hour under the same contact details. 5 requests per rolling hour,
 * per key, sits comfortably above realistic use while forcing a
 * stock-draining script to keep minting fresh, distinct emails *and*
 * phone numbers every 5 attempts instead of just cycling IPs/headers.
 */
const ORDER_REQUEST_LIMIT = 5;
const ORDER_REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function orderRequestKey(kind: "email" | "phone", value: string): string {
  return `order-request:${kind}:${value}`;
}

/**
 * Returns a 429 `NextResponse` if either the email or the phone this
 * ORDER_REQUEST is being placed under has already hit the limit; `null`
 * when the request may proceed. Callers must check this *before* calling
 * createOrderFromCart, so a throttled request never decrements stock or
 * creates an Order row.
 */
export async function orderRequestThrottleOrResponse(
  email: string,
  phone: string | undefined,
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1") {
    return null;
  }

  const keys = [orderRequestKey("email", email.trim().toLowerCase())];
  if (phone && phone.trim()) {
    keys.push(orderRequestKey("phone", phone.trim()));
  }

  for (const key of keys) {
    const result = await checkRateLimit(key, ORDER_REQUEST_LIMIT, ORDER_REQUEST_WINDOW_MS);
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            "Too many order requests for this email/phone. Please wait before submitting another, or contact us to complete this order.",
        },
        { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
      );
    }
  }

  return null;
}
