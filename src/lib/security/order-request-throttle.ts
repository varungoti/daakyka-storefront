import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp, refundRateLimit } from "@/lib/security/rate-limit";

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
 * a script that drains the catalogue for free.
 *
 * This throttles on the *identity the order is placed under* — normalised
 * email and phone, each checked independently against the existing
 * DB-backed limiter (src/lib/security/rate-limit.ts's checkRateLimit,
 * called here with a dedicated key namespace). Forging a new *working*
 * email and phone for every batch of orders is a meaningfully higher bar
 * than reusing the same identity, and this combines with — rather than
 * replaces — the route's existing IP limit.
 *
 * F-118: identity alone isn't enough on its own, though — both email and
 * phone are values the caller supplies in the request body, so a script
 * can defeat the identity keys by minting a fresh random pair on every
 * request. checkRequest also keys a hard cap on the request's own IP,
 * read the same trusted way rate-limit.ts's getClientIp does (never a
 * client-controlled header), so that bypass still has to originate from
 * *some* bounded number of IPs — a meaningfully higher bar than generating
 * random strings.
 *
 * Limits: a real institutional buyer placing a manual/unpaid order
 * request might resubmit a couple of times (a typo, a network hiccup, a
 * second department's cart) but essentially never more than a handful in
 * an hour under the same contact details. 5 requests per rolling hour,
 * per identity key, sits comfortably above realistic use while forcing a
 * stock-draining script to keep minting fresh, distinct emails *and*
 * phone numbers every 5 attempts; ORDER_REQUEST_IP_LIMIT is deliberately
 * higher (an IP is shared more legitimately — a hospital's procurement
 * desk placing several institutional orders) but still bounds the total
 * damage one address can do no matter how many identities it cycles
 * through.
 */
const ORDER_REQUEST_LIMIT = 5;
const ORDER_REQUEST_IP_LIMIT = 20;
const ORDER_REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function orderRequestKey(kind: "email" | "phone" | "ip", value: string): string {
  return `order-request:${kind}:${value}`;
}

export interface OrderRequestThrottleResult {
  /** A 429 `NextResponse` if this ORDER_REQUEST attempt is throttled;
   * `null` when it may proceed. Callers must check this *before* calling
   * createOrderFromCart, so a throttled request never decrements stock or
   * creates an Order row. */
  response: NextResponse | null;
  /**
   * F-123: the bucket keys this call actually incremented (never
   * including a key whose own check is what caused the block — a blocked
   * email must not also burn the phone's allowance, and a blocked IP must
   * not burn either identity's). Pass these to
   * releaseOrderRequestThrottle() when the order attempt then fails for a
   * reason the shopper can fix and retry (out of stock, an invalid
   * variant, an empty cart, a bad discount code) — never on success, and
   * never when `response` is already set (there's nothing to release).
   */
  consumedKeys: string[];
}

/**
 * Checks the ORDER_REQUEST throttle for this attempt. See the module doc
 * comment above for what's keyed and why.
 */
export async function orderRequestThrottleOrResponse(
  request: Request,
  email: string,
  phone: string | undefined,
): Promise<OrderRequestThrottleResult> {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1") {
    return { response: null, consumedKeys: [] };
  }

  const consumedKeys: string[] = [];

  // F-118: the hard cap, checked first — an attacker who can't clear this
  // never gets to burn through the identity keys below with junk data.
  const ip = getClientIp(request);
  if (ip) {
    const ipKey = orderRequestKey("ip", ip);
    const ipResult = await checkRateLimit(ipKey, ORDER_REQUEST_IP_LIMIT, ORDER_REQUEST_WINDOW_MS);
    if (!ipResult.ok) {
      return {
        response: NextResponse.json(
          {
            error:
              "Too many order requests from this network. Please wait before submitting another, or contact us to complete this order.",
          },
          { status: 429, headers: { "Retry-After": String(ipResult.retryAfter) } },
        ),
        consumedKeys,
      };
    }
    consumedKeys.push(ipKey);
  }

  const identityKeys = [orderRequestKey("email", email.trim().toLowerCase())];
  if (phone && phone.trim()) {
    identityKeys.push(orderRequestKey("phone", phone.trim()));
  }

  for (const key of identityKeys) {
    const result = await checkRateLimit(key, ORDER_REQUEST_LIMIT, ORDER_REQUEST_WINDOW_MS);
    if (!result.ok) {
      return {
        response: NextResponse.json(
          {
            error:
              "Too many order requests for this email/phone. Please wait before submitting another, or contact us to complete this order.",
          },
          { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
        ),
        consumedKeys,
      };
    }
    consumedKeys.push(key);
  }

  return { response: null, consumedKeys };
}

/**
 * F-123: gives back every key `orderRequestThrottleOrResponse` consumed
 * for an attempt that then failed for a reason the shopper can fix and
 * retry (their cart went out of stock between page load and submit, an
 * invalid discount code, an empty cart) — so retrying isn't already a
 * step closer to a 429 for a broken cart that was never abuse to begin
 * with. Best-effort: see refundRateLimit's own doc comment.
 */
export async function releaseOrderRequestThrottle(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => refundRateLimit(key)));
}
