import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractRequestAttribution } from "@/lib/analytics/attribution";
import {
  createOrderFromCart,
  EmptyCartError,
  InvalidVariantError,
  OutOfStockError,
} from "@/lib/orders/create-order";
import {
  DiscountAlreadyUsedError,
  DiscountExpiredError,
  DiscountInactiveError,
  DiscountMinSubtotalError,
  DiscountNotFoundError,
  DiscountNotStartedError,
  DiscountUsageLimitReachedError,
} from "@/lib/discounts";
import { notifyNewOrder } from "@/lib/orders/notify";
import { createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured } from "@/lib/payments/razorpay";
import {
  orderRequestThrottleOrResponse,
  releaseOrderRequestThrottle,
} from "@/lib/security/order-request-throttle";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { identityRateLimitOrResponse } from "@/lib/security/rate-limit";
import { checkoutSchema } from "@/lib/validation/schemas";

/**
 * Best-effort link to a logged-in customer, once D1 (customer accounts,
 * src/lib/customer-auth/session.ts) has landed. Never trusted from the
 * client body — only ever read from the verified session cookie
 * server-side — and never allowed to block or fail checkout: a missing
 * module, a different export shape, or a session lookup error all just
 * fall back to a guest order (customerId left undefined).
 */
async function getOptionalCustomerId(): Promise<string | undefined> {
  try {
    const sessionModule = await import("@/lib/customer-auth/session").catch(() => null);
    if (!sessionModule || typeof sessionModule.getCustomerSession !== "function") {
      return undefined;
    }
    const session = await sessionModule.getCustomerSession();
    if (session && typeof session === "object" && typeof (session as { id?: unknown }).id === "string") {
      return (session as { id: string }).id;
    }
  } catch {
    // Best-effort only — guest checkout must never be blocked by this.
  }
  return undefined;
}

/**
 * Phase D3: creates a native-catalog order from the client's cart lines,
 * re-pricing everything server-side (see createOrderFromCart), then either:
 *  - Razorpay is configured: also creates a Razorpay order and returns the
 *    details Checkout.js needs to open the payment modal.
 *  - Razorpay is NOT configured (this environment — no keys available):
 *    the order is created with paymentMethod=ORDER_REQUEST and returns
 *    `{orderNumber, fallback: true}` — no Razorpay fields at all. This is
 *    the checkout page's real fallback path (see /checkout).
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = checkoutSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid checkout details", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { items, email, phone, shippingAddress, discountCode } = parsed.data;

  // F-322: keyed on IP+email (a tight per-identity bucket, plus a loose
  // per-IP backstop) rather than IP alone — independent shoppers checking
  // out from the same network (hospital Wi-Fi, a shared office) must not
  // throttle each other. Body is parsed first so the email is available to
  // key on; it's a cheap, size-capped parse (readJsonBody), not a DB call.
  const limited = await identityRateLimitOrResponse(request, "checkout", 10, 60_000, {
    identity: email,
  });
  if (limited) return limited;

  const razorpayReady = await isRazorpayConfigured();

  // Finding B: the ORDER_REQUEST fallback below has no payment gate, so an
  // IP-independent throttle keyed on the order's own email/phone (plus,
  // F-118, a hard IP cap) guards it against a script that mints fresh
  // identities to drain stock for free. A Razorpay-bound order still has
  // to clear real payment, so it isn't throttled here.
  //
  // F-123: consumedThrottleKeys is what got incremented, so a submit that
  // then fails for a reason the shopper can fix and retry (their cart went
  // out of stock, an invalid variant, an empty cart, a bad discount code)
  // can give that use back in the catch block below, rather than counting
  // a broken-cart retry the same as a stock-draining script.
  let consumedThrottleKeys: string[] = [];
  if (!razorpayReady) {
    const throttle = await orderRequestThrottleOrResponse(request, email, phone);
    if (throttle.response) return throttle.response;
    consumedThrottleKeys = throttle.consumedKeys;
  }

  try {
    const customerId = await getOptionalCustomerId();
    // F-318: best-effort attribution (query params / Referer header) —
    // see src/lib/analytics/attribution.ts.
    const attribution = extractRequestAttribution(request);
    const order = await createOrderFromCart({
      items,
      email,
      phone,
      shippingAddress,
      customerId,
      paymentMethod: razorpayReady ? "RAZORPAY" : "ORDER_REQUEST",
      discountCode,
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
      referrer: attribution.referrer,
    });

    if (!razorpayReady) {
      // No online payment step for this order — notify now, not at /verify.
      await notifyNewOrder({
        orderId: order.id,
        orderNumber: order.number,
        email: order.email,
        total: order.total,
        currency: order.currency,
        fallback: true,
        orderToken: order.accessToken,
        // F-073 fix: lets notifyNewOrder enroll this order in the
        // "order_created" post-purchase journey with a real phone/name.
        phone,
        firstName: shippingAddress.name.trim().split(" ")[0],
      }).catch(() => undefined);

      return NextResponse.json({ orderNumber: order.number, orderToken: order.accessToken, fallback: true });
    }

    let razorpayOrder;
    try {
      razorpayOrder = await createRazorpayOrder(
        Math.round(order.total * 100),
        order.currency,
        order.number,
      );
    } catch (error) {
      // The Order row already exists as PENDING_PAYMENT with no
      // razorpayOrderId; the cancel-stale-orders cron cleans it up after
      // 30 minutes if the customer never retries.
      console.error(`[checkout] Razorpay order creation failed for ${order.number}`, error);
      return NextResponse.json({ error: "Could not start payment. Please try again." }, { status: 502 });
    }

    await db.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: razorpayOrder.id },
    });

    return NextResponse.json({
      orderNumber: order.number,
      orderToken: order.accessToken,
      razorpayOrderId: razorpayOrder.id,
      keyId: await getRazorpayKeyId(),
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    });
  } catch (error) {
    if (error instanceof EmptyCartError) {
      await releaseOrderRequestThrottle(consumedThrottleKeys);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof OutOfStockError) {
      await releaseOrderRequestThrottle(consumedThrottleKeys);
      // F-121: `available` lets the checkout summary offer "Update qty"
      // for the flagged line instead of only a banner naming it.
      return NextResponse.json(
        { error: error.message, variantId: error.variantId, available: error.available },
        { status: 409 },
      );
    }
    if (error instanceof InvalidVariantError) {
      await releaseOrderRequestThrottle(consumedThrottleKeys);
      return NextResponse.json(
        { error: error.message, variantId: error.variantId },
        { status: 400 },
      );
    }
    if (
      error instanceof DiscountNotFoundError ||
      error instanceof DiscountInactiveError ||
      error instanceof DiscountNotStartedError ||
      error instanceof DiscountExpiredError ||
      error instanceof DiscountMinSubtotalError ||
      error instanceof DiscountUsageLimitReachedError ||
      error instanceof DiscountAlreadyUsedError
    ) {
      await releaseOrderRequestThrottle(consumedThrottleKeys);
      return NextResponse.json({ error: error.message, field: "discountCode" }, { status: 400 });
    }
    console.error("[checkout] failed to create order", error);
    return NextResponse.json({ error: "Could not process checkout" }, { status: 500 });
  }
}
