import { createHmac } from "node:crypto";
import Razorpay from "razorpay";
import { getCredential } from "@/lib/integrations/credential-store";
import { safeEquals } from "@/lib/security/timing-safe-equal";

/**
 * Phase D3: thin wrapper around the official `razorpay` Node SDK plus the
 * HMAC verification helpers Razorpay's docs specify for the checkout
 * success callback and for webhooks. Everything here reports "not
 * configured" rather than throwing when no key is available, so the
 * checkout route can degrade to the order-request fallback (see
 * src/lib/orders/create-order.ts and /api/checkout) instead of crashing.
 *
 * Credentials resolve DB-first (admin-settable via /admin/integrations,
 * see src/lib/integrations/credential-store.ts) then fall back to
 * process.env, so an env-var-only deploy keeps working unchanged.
 */

async function resolveKeyId(): Promise<string | undefined> {
  return (await getCredential("RAZORPAY", "KEY_ID")) ?? process.env.RAZORPAY_KEY_ID ?? undefined;
}

async function resolveKeySecret(): Promise<string | undefined> {
  return (
    (await getCredential("RAZORPAY", "KEY_SECRET")) ?? process.env.RAZORPAY_KEY_SECRET ?? undefined
  );
}

async function resolveWebhookSecret(): Promise<string | undefined> {
  return (
    (await getCredential("RAZORPAY", "WEBHOOK_SECRET")) ??
    process.env.RAZORPAY_WEBHOOK_SECRET ??
    undefined
  );
}

export async function isRazorpayConfigured(): Promise<boolean> {
  const [keyId, keySecret] = await Promise.all([resolveKeyId(), resolveKeySecret()]);
  return Boolean(keyId && keySecret);
}

/** The publishable key id the client-side Checkout.js widget needs — never
 * the secret. Used by POST /api/checkout to hand it back in the response. */
export async function getRazorpayKeyId(): Promise<string | undefined> {
  return resolveKeyId();
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
let cachedKeyId: string | undefined;
let clientOverridden = false;

async function getDefaultClient(): Promise<RazorpayOrderClient> {
  if (clientOverridden && cachedClient) return cachedClient;

  const [keyId, keySecret] = await Promise.all([resolveKeyId(), resolveKeySecret()]);
  // Rebuild whenever the resolved key id changes (e.g. an admin just set or
  // cleared the DB-backed credential) rather than caching forever — a DB
  // write must take effect on the very next request, not after a restart.
  if (!cachedClient || cachedKeyId !== keyId) {
    // Cast: the real Razorpay client's `orders.create` genuinely satisfies
    // this narrower interface at runtime; its full generated type is a
    // large overloaded union (see node_modules/razorpay/dist/types/orders.d.ts)
    // that isn't worth threading through here.
    cachedClient = new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpayOrderClient;
    cachedKeyId = keyId;
  }
  return cachedClient;
}

/** Test-only: replaces (or clears, with `null`) the module-level Razorpay
 * client so unit/integration tests can inject a fake without touching the
 * network or real credentials. */
export function setRazorpayClientForTesting(client: RazorpayOrderClient | null): void {
  cachedClient = client;
  cachedKeyId = undefined;
  clientOverridden = client !== null;
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
  if (!(await isRazorpayConfigured())) {
    throw new RazorpayNotConfiguredError();
  }
  const client = deps.client ?? (await getDefaultClient());
  return client.orders.create({
    amount: Math.round(amountInPaise),
    currency,
    // Razorpay caps receipt at 40 characters; our order numbers
    // (DK-YYYY-NNNNNNNNNN) are well under that.
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
export async function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const secret = await resolveKeySecret();
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
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const secret = await resolveWebhookSecret();
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEquals(expected, signature);
}
