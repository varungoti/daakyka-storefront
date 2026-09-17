import { createHmac } from "node:crypto";
import Razorpay from "razorpay";
import { safeEquals } from "@/lib/security/timing-safe-equal";

/**
 * Phase D3: thin wrapper around the official `razorpay` Node SDK plus the
 * HMAC verification helpers Razorpay's docs specify for the checkout
 * success callback and for webhooks. Everything here reports "not
 * configured" rather than throwing when env vars are missing, so the
 * checkout route can degrade to the order-request fallback (see
 * src/lib/orders/create-order.ts and /api/checkout) instead of crashing.
 */

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export class RazorpayNotConfiguredError extends Error {
  constructor(message = "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET") {
    super(message);
    this.name = "RazorpayNotConfiguredError";
  }
}

export interface RazorpayOrderResult {
  id: string;
  amount: number;
  currency: string;
  receipt?: string | null;
}

/**
 * The minimal shape `createRazorpayOrder` needs from a Razorpay client —
 * small enough that tests can inject an in-memory fake that never touches
 * the network, mirroring the `OpenAIImageClient` pattern in
 * src/lib/ai/image-generation.ts.
 */
export interface RazorpayOrderClient {
  orders: {
    create(params: {
      amount: number;
      currency: string;
      receipt: string;
      payment_capture?: boolean;
    }): Promise<RazorpayOrderResult>;
  };
}

let cachedClient: RazorpayOrderClient | null = null;

function getDefaultClient(): RazorpayOrderClient {
  if (!cachedClient) {
    // Cast: the real Razorpay client's `orders.create` genuinely satisfies
    // this narrower interface at runtime; its full generated type is a
    // large overloaded union (see node_modules/razorpay/dist/types/orders.d.ts)
    // that isn't worth threading through here.
    cachedClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    }) as unknown as RazorpayOrderClient;
  }
  return cachedClient;
}

/** Test-only: replaces (or clears, with `null`) the module-level Razorpay
 * client so unit/integration tests can inject a fake without touching the
 * network or real credentials. */
export function setRazorpayClientForTesting(client: RazorpayOrderClient | null): void {
  cachedClient = client;
}

export interface CreateRazorpayOrderDeps {
  client?: RazorpayOrderClient;
}

export async function createRazorpayOrder(
  amountInPaise: number,
  currency: string,
  receipt: string,
  deps: CreateRazorpayOrderDeps = {},
): Promise<RazorpayOrderResult> {
  if (!isRazorpayConfigured()) {
    throw new RazorpayNotConfiguredError();
  }
  const client = deps.client ?? getDefaultClient();
  return client.orders.create({
    amount: Math.round(amountInPaise),
    currency,
    // Razorpay caps receipt at 40 characters; our order numbers
    // (DK-YYYY-NNNNNN) are well under that.
    receipt,
    payment_capture: true,
  });
}

/**
 * Verifies the HMAC-SHA256 signature Razorpay Checkout.js returns after a
 * successful payment: `hmac_sha256(order_id + "|" + payment_id, key_secret)`
 * (see https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/#step-6-verify-payment-signature).
 * Compared with `safeEquals` to avoid leaking timing information.
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEquals(expected, signature);
}

/**
 * Verifies the `X-Razorpay-Signature` header on an incoming webhook:
 * `hmac_sha256(raw_request_body, webhook_secret)`. Must be run against the
 * exact raw body bytes/string Razorpay signed — never a re-serialized
 * JSON.parse(...).toString(), which can differ in whitespace/key order.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEquals(expected, signature);
}
