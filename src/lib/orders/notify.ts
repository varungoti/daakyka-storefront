import { brand } from "@/data/brand";
import { db } from "@/lib/db";
import type { PaymentMethod } from "@/generated/prisma/client";
import { EMAIL_KIND, sendTransactionalEmail, type EmailKind } from "@/lib/engagement/outbox";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { signOrderLink } from "@/lib/orders/access-token";
import { getCourierTrackingUrl } from "@/lib/orders/courier-tracking";
import { getSetting } from "@/lib/settings";

/**
 * Phase D3: best-effort order notifications. Reuses the existing Brevo
 * abstraction (src/lib/engagement/providers/email.ts, already a no-op
 * "stub" provider when Brevo isn't configured — see
 * src/lib/integrations/enabled.ts) for the customer + admin emails, and
 * the same `AdminNotification` row pattern used by the Shopify order
 * webhook and the engagement campaign dispatcher (see
 * src/app/api/webhooks/shopify/orders/route.ts,
 * src/lib/engagement/campaign-dispatcher.ts) so an admin always sees a new
 * order even when email is unconfigured.
 *
 * F7 fix: sends go through sendTransactionalEmail() (src/lib/engagement/
 * outbox.ts) instead of sendEmail() directly, so a failed/unconfigured
 * send is persisted to the EmailOutbox and retried once Brevo is
 * configured, rather than only ever reaching this file's console.log.
 *
 * Every step is independently wrapped — an email or DB failure here is
 * logged and swallowed, never thrown, so it can't fail or block the
 * checkout/verify/webhook response that already did the important work
 * (creating or paying the order).
 */

export interface NotifyNewOrderInput {
  /** F-284 fix: needed to build a signed fallback link (signOrderLink)
   * whenever the caller has no raw `orderToken` — see that field's own
   * doc comment. Every current caller has the order row in hand already,
   * so this is never a new DB read. */
  orderId: string;
  orderNumber: string;
  email: string;
  total: number;
  currency: string;
  /** True for an ORDER_REQUEST order (no online payment yet); false once a
   * Razorpay payment has actually been captured. */
  fallback: boolean;
  /**
   * Phase G hardening (fixes finding F2): the order's raw guest-access
   * token (src/lib/orders/access-token.ts), when the caller has it —
   * order creation always does; POST /api/checkout/verify forwards and
   * re-verifies one from the client. Used to link the customer email
   * straight to their tokenised /order/[number] confirmation page.
   *
   * F-284 fix: omitted (e.g. from the Razorpay webhook, which never sees
   * the raw token — only its hash is ever persisted) used to mean the
   * email had no link at all. It now falls back to a stateless signed
   * link (signOrderLink) built from `orderId` instead, so every customer
   * email links somewhere, whichever path (verify or webhook) confirmed
   * the order.
   */
  orderToken?: string;
  /**
   * F-283 fix (release-hardening order-lifecycle-payment-integrity): true
   * when this payment was captured but one or more lines lost the stock
   * race in between (see /api/checkout/verify and the Razorpay webhook's
   * `stockConflict` — an AdminNotification is already raised separately
   * for that). RAZORPAY orders don't reserve stock at creation, so this is
   * the shopper's only honest signal that "payment received" does not
   * necessarily mean "the item is still coming" — the customer email must
   * say so instead of promising shipment. Omitted/false for the normal
   * path and for every ORDER_REQUEST order (fallback:true), which never
   * hits this conflict in the first place.
   */
  stockConflict?: boolean;
  /**
   * F-073 fix: the order's contact phone and shopper name (from
   * Order.phone / the shippingAddress the caller already has) — passed
   * through so the seeded "Post-Purchase Journey" (trigger `order_created`)
   * actually gets enrolled for this store's own orders, not only for the
   * legacy Shopify order webhook (see src/app/api/webhooks/shopify/orders/
   * route.ts, the only other `order_created` trigger site). Both optional:
   * a caller that doesn't have them (there are none today, but a future
   * one might) just means the journey enrolls with whatever it has, same
   * as triggerJourneys already tolerates from its other call sites.
   */
  phone?: string;
  firstName?: string;
}

function formatAmount(total: number, currency: string): string {
  return `${currency} ${total.toFixed(2)}`;
}

/** Matches the small per-file `siteUrl()` helper already duplicated in
 * src/lib/customer-auth/mailer.ts and src/lib/engagement/unsubscribe.ts
 * rather than centralizing it — same convention, different file. */
function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com").replace(/\/$/, "");
}

function buildOrderConfirmationUrl(orderNumber: string, auth: { token: string } | { sig: string }): string {
  const query = "token" in auth ? `token=${encodeURIComponent(auth.token)}` : `sig=${encodeURIComponent(auth.sig)}`;
  return `${siteUrl()}/order/${encodeURIComponent(orderNumber)}?${query}`;
}

export async function notifyNewOrder(input: NotifyNewOrderInput): Promise<void> {
  const { orderId, orderNumber, email, total, currency, fallback, orderToken, stockConflict, phone, firstName } =
    input;
  const amount = formatAmount(total, currency);
  // F-284 fix: always resolves to a working link now — a real capability
  // token when the caller has one, otherwise the stateless signed
  // fallback (see signOrderLink's doc comment). getAuthorizedOrder
  // (src/lib/orders/get-order.ts) accepts either.
  const orderLink = buildOrderConfirmationUrl(
    orderNumber,
    orderToken ? { token: orderToken } : { sig: signOrderLink(orderId, orderNumber) },
  );
  const orderLinkHtml = `<p><a href="${orderLink}">View your order</a></p>`;
  // F-125: no page/email in the money path stated whether prices include
  // tax, or named the seller/GSTIN. GSTIN is left out entirely (not a
  // placeholder) until the owner has actually registered and entered one.
  const gstin = await getSetting("legal.gstin");
  const taxFooterHtml = `<p style="color:#6b6475;font-size:12px;">Prices are inclusive of all taxes. Sold by ${brand.legalName}${gstin ? ` &middot; GSTIN ${gstin}` : ""}.</p>`;

  try {
    const result = await sendTransactionalEmail(
      {
        to: email,
        subject: stockConflict
          ? `Payment received — order ${orderNumber} (stock issue)`
          : fallback
            ? `We received your order ${orderNumber}`
            : `Payment received — order ${orderNumber}`,
        html:
          (stockConflict
            ? // F-283 fix: never claim "we'll let you know as soon as it
              // ships" when a line actually lost the stock race — that's a
              // real risk of promising something we can't fulfil.
              `<p>Your payment for order <strong>${orderNumber}</strong> (${amount}) was received, but one or more items in this order sold out just before your payment completed. Our team will contact you shortly about a refund for the affected item(s) or a replacement.</p>${orderLinkHtml}`
            : fallback
              ? `<p>Thanks for your order <strong>${orderNumber}</strong> (${amount}). Our team will contact you shortly to confirm payment and delivery.</p>${orderLinkHtml}`
              : `<p>Your payment for order <strong>${orderNumber}</strong> (${amount}) was received. We'll let you know as soon as it ships.</p>${orderLinkHtml}`) +
          taxFooterHtml,
      },
      EMAIL_KIND.ORDER_CONFIRMATION_CUSTOMER,
    );
    if (!result.ok) {
      // Not lost: recorded PENDING in EmailOutbox (outboxId) for the drain
      // cron to retry — this log is now just a local breadcrumb, not the
      // only record.
      console.log(
        `[orders/notify] customer email not sent for ${orderNumber} (provider=${result.provider}, outboxId=${result.outboxId}): ${result.error ?? "unknown reason"}`,
      );
    }
  } catch (error) {
    console.log(`[orders/notify] customer email threw for ${orderNumber}:`, error);
  }

  try {
    const adminEmail = await getSetting("contact.email");
    if (adminEmail) {
      const result = await sendTransactionalEmail(
        {
          to: adminEmail,
          subject: `New order ${orderNumber}${fallback ? " (order request — payment pending)" : " (paid)"}`,
          html: `<p>Order <strong>${orderNumber}</strong> from ${email} — ${amount}. ${
            fallback
              ? "Payment has not been collected online; contact the customer to confirm."
              : "Payment received via Razorpay."
          }</p>`,
        },
        EMAIL_KIND.ORDER_CONFIRMATION_ADMIN,
      );
      if (!result.ok) {
        console.log(
          `[orders/notify] admin email not sent for ${orderNumber} (provider=${result.provider}, outboxId=${result.outboxId}): ${result.error ?? "unknown reason"}`,
        );
      }
    }
  } catch (error) {
    console.log(`[orders/notify] admin email threw for ${orderNumber}:`, error);
  }

  try {
    await db.adminNotification.create({
      data: {
        title: `New order ${orderNumber}`,
        body: `${email} — ${amount}${fallback ? " (order request, payment pending)" : " (paid)"}`,
        type: fallback ? "order_request" : "order_paid",
        metadata: JSON.stringify({ orderNumber, email, total, currency, fallback }),
      },
    });
  } catch (error) {
    console.log(`[orders/notify] admin notification create failed for ${orderNumber}:`, error);
  }

  // F-073 fix: this used to be the one thing missing for this store's own
  // orders — every triggerJourneys() call site was a form (newsletter,
  // bulk-orders, contact, cart/abandon) or the legacy Shopify order
  // webhook, so the seeded "Post-Purchase Journey" (trigger `order_created`,
  // shown as ACTIVE in /admin/engagement and referenced by /admin/reputation
  // and the launch docs) never actually enrolled a real customer. Own
  // try/catch, like every other step in this function: a journey failure
  // must never affect the checkout/verify/webhook response that already
  // did the important work.
  //
  // enrollInJourney (journey-engine.ts) only dedupes by "no ACTIVE
  // enrollment for this email in this journey", not by order number — a
  // customer whose previous order's enrollment is still ACTIVE (this
  // journey's last step is +720h) won't be re-enrolled for a second order
  // placed within that window. Accepted trade-off (see F-073's own fix
  // guidance) rather than a schema change to dedupe on order number.
  try {
    await triggerJourneys("order_created", { email, phone, firstName });
  } catch (error) {
    console.log(`[orders/notify] order_created journey trigger failed for ${orderNumber}:`, error);
  }
}

/**
 * F-067 fix (release-hardening seo-canonical-notify-and-deploy-security):
 * notifyNewOrder above only ever covers "order placed"/"payment received" —
 * nothing told a customer their order later shipped or was cancelled, even
 * though the payment email promises "we'll let you know as soon as it
 * ships" (see the RAZORPAY branch above). Called from updateOrderAdmin
 * (src/lib/orders/admin-orders.ts) whenever an admin actually changes the
 * order's status to one of these three.
 *
 * Best-effort like notifyNewOrder: every failure is logged and swallowed,
 * never thrown, so a mail problem can never fail the admin's save or roll
 * back the status change/restock that already committed.
 */
export interface NotifyOrderStatusChangeInput {
  orderNumber: string;
  email: string;
  toStatus: "SHIPPED" | "CANCELLED" | "REFUNDED";
  /** Order.trackingNumber/courier — admin free text (see admin-orders.ts's
   * orderUpdateSchema), HTML-escaped below before it goes near the email. */
  trackingNumber?: string | null;
  courier?: string | null;
  paymentMethod: PaymentMethod;
  /**
   * Mirrors getOrderTimeline's `hasCapturedPayment` (src/lib/orders/
   * timeline.ts) — only meaningful when paymentMethod is RAZORPAY. Default
   * true (a payment was captured) so a caller that doesn't know better
   * gets the safer "you may have been charged" wording rather than
   * wrongly telling a charged customer nothing was taken.
   */
  hasCapturedPayment?: boolean;
}

/** Matches the small `escapeHtmlValue` helper duplicated in
 * src/lib/engagement/template.ts — trackingNumber/courier here are
 * admin-typed free text, not app-controlled strings, so they must never
 * reach the email HTML unescaped. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function notifyOrderStatusChange(input: NotifyOrderStatusChangeInput): Promise<void> {
  const { orderNumber, email, toStatus, trackingNumber, courier, paymentMethod, hasCapturedPayment = true } = input;

  let kind: EmailKind;
  let subject: string;
  let html: string;

  if (toStatus === "SHIPPED") {
    kind = EMAIL_KIND.ORDER_SHIPPED_CUSTOMER;
    subject = `Your order ${orderNumber} has shipped`;
    const safeTrackingNumber = trackingNumber ? escapeHtml(trackingNumber) : null;
    const safeCourier = courier ? escapeHtml(courier) : null;
    const trackingUrl = getCourierTrackingUrl(courier, trackingNumber);
    const courierSuffix = safeCourier ? ` via ${safeCourier}` : "";
    const trackingLine = safeTrackingNumber
      ? `<p>Tracking number${courierSuffix}: ${
          trackingUrl
            ? `<a href="${trackingUrl}">${safeTrackingNumber}</a>`
            : `<strong>${safeTrackingNumber}</strong>`
        }</p>`
      : "";
    html = `<p>Good news — your order <strong>${orderNumber}</strong> has shipped.</p>${trackingLine}`;
  } else if (toStatus === "CANCELLED") {
    kind = EMAIL_KIND.ORDER_CANCELLED_CUSTOMER;
    subject = `Your order ${orderNumber} was cancelled`;
    // Same "don't claim what isn't verifiable" rule as getOrderTimeline's
    // CANCELLED case (src/lib/orders/timeline.ts) — only a RAZORPAY order
    // that never captured a payment is known for certain to have taken no
    // money; every other cancelled order (including ORDER_REQUEST, which
    // is never charged online either way) gets the same neutral hedge.
    const neverPaid = paymentMethod === "RAZORPAY" && !hasCapturedPayment;
    html = neverPaid
      ? `<p>Your order <strong>${orderNumber}</strong> has been cancelled. Payment was not completed, so no charge was made — you can place a new order any time.</p>`
      : `<p>Your order <strong>${orderNumber}</strong> has been cancelled. If you were charged, any eligible refund will be issued to your original payment method.</p>`;
  } else {
    kind = EMAIL_KIND.ORDER_REFUNDED_CUSTOMER;
    subject = `Your order ${orderNumber} was refunded`;
    html = `<p>Your order <strong>${orderNumber}</strong> has been refunded. Please allow a few business days for the amount to reflect in your original payment method.</p>`;
  }

  try {
    const result = await sendTransactionalEmail({ to: email, subject, html }, kind);
    if (!result.ok) {
      console.log(
        `[orders/notify] status-change email not sent for ${orderNumber} (${toStatus}) (provider=${result.provider}, outboxId=${result.outboxId}): ${result.error ?? "unknown reason"}`,
      );
    }
  } catch (error) {
    console.log(`[orders/notify] status-change email threw for ${orderNumber} (${toStatus}):`, error);
  }
}
