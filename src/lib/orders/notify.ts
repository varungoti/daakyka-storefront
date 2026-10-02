import { db } from "@/lib/db";
import type { PaymentMethod } from "@/generated/prisma/client";
import { emailSiteUrl, formatEmailMoney, loadEmailFooter } from "@/lib/email/layout";
import { EMAIL_KIND, sendTransactionalEmail, type EmailKind } from "@/lib/engagement/outbox";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { signOrderLink } from "@/lib/orders/access-token";
import {
  loadOrderEmailData,
  renderAdminOrderEmail,
  renderCustomerOrderEmail,
  renderOrderStatusEmail,
} from "@/lib/orders/order-email";
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
 *
 * F-041: the bodies themselves are built by src/lib/orders/order-email.ts
 * (branded layout, item table, address, ₹ totals, store footer, explicit
 * text part with every URL) — this file only decides *what* to send.
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

function buildOrderConfirmationUrl(orderNumber: string, auth: { token: string } | { sig: string }): string {
  const query = "token" in auth ? `token=${encodeURIComponent(auth.token)}` : `sig=${encodeURIComponent(auth.sig)}`;
  return `${emailSiteUrl()}/order/${encodeURIComponent(orderNumber)}?${query}`;
}

export async function notifyNewOrder(input: NotifyNewOrderInput): Promise<void> {
  const { orderId, orderNumber, email, total, currency, fallback, orderToken, stockConflict, phone, firstName } =
    input;
  const amount = formatEmailMoney(total, currency);
  // F-284 fix: always resolves to a working link now — a real capability
  // token when the caller has one, otherwise the stateless signed
  // fallback (see signOrderLink's doc comment). getAuthorizedOrder
  // (src/lib/orders/get-order.ts) accepts either.
  const orderLink = buildOrderConfirmationUrl(
    orderNumber,
    orderToken ? { token: orderToken } : { sig: signOrderLink(orderId, orderNumber) },
  );
  // F-041: both loaders swallow their own failures (null / settings
  // defaults), so a problem reading the order or the footer settings only
  // ever costs the item table — the email still goes out.
  const [footer, orderData] = await Promise.all([loadEmailFooter(), loadOrderEmailData(orderId)]);

  try {
    // F-125/F-283: tax-inclusive note, seller/GSTIN footer and the
    // stock-conflict wording ("never promise it ships") live in
    // renderCustomerOrderEmail.
    const customerEmail = renderCustomerOrderEmail({
      orderNumber,
      total,
      currency,
      fallback,
      stockConflict: Boolean(stockConflict),
      orderLink,
      order: orderData,
      footer,
    });
    const result = await sendTransactionalEmail(
      { to: email, subject: customerEmail.subject, html: customerEmail.html, text: customerEmail.text },
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
      const adminMessage = renderAdminOrderEmail({
        orderId,
        orderNumber,
        customerEmail: email,
        total,
        currency,
        fallback,
        order: orderData,
        footer,
      });
      const result = await sendTransactionalEmail(
        { to: adminEmail, subject: adminMessage.subject, html: adminMessage.html, text: adminMessage.text },
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

export async function notifyOrderStatusChange(input: NotifyOrderStatusChangeInput): Promise<void> {
  const { orderNumber, email, toStatus, trackingNumber, courier, paymentMethod, hasCapturedPayment = true } = input;

  const kind: EmailKind =
    toStatus === "SHIPPED"
      ? EMAIL_KIND.ORDER_SHIPPED_CUSTOMER
      : toStatus === "CANCELLED"
        ? EMAIL_KIND.ORDER_CANCELLED_CUSTOMER
        : EMAIL_KIND.ORDER_REFUNDED_CUSTOMER;

  try {
    // F-041: branded layout, store footer and an explicit text part (with
    // the tracking URL) — see renderOrderStatusEmail. trackingNumber and
    // courier are admin free text; the renderer HTML-escapes them.
    const footer = await loadEmailFooter();
    const message = renderOrderStatusEmail({
      orderNumber,
      toStatus,
      trackingNumber,
      courier,
      paymentMethod,
      hasCapturedPayment,
      footer,
    });
    const result = await sendTransactionalEmail(
      { to: email, subject: message.subject, html: message.html, text: message.text },
      kind,
    );
    if (!result.ok) {
      console.log(
        `[orders/notify] status-change email not sent for ${orderNumber} (${toStatus}) (provider=${result.provider}, outboxId=${result.outboxId}): ${result.error ?? "unknown reason"}`,
      );
    }
  } catch (error) {
    console.log(`[orders/notify] status-change email threw for ${orderNumber} (${toStatus}):`, error);
  }
}
