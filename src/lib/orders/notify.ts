import { db } from "@/lib/db";
import { EMAIL_KIND, sendTransactionalEmail } from "@/lib/engagement/outbox";
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
   * Omitted (e.g. from the Razorpay webhook, which never sees the raw
   * token — only its hash is ever persisted) just means the email has no
   * direct link, same as before this field existed.
   */
  orderToken?: string;
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

function buildOrderConfirmationUrl(orderNumber: string, orderToken: string): string {
  return `${siteUrl()}/order/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(orderToken)}`;
}

export async function notifyNewOrder(input: NotifyNewOrderInput): Promise<void> {
  const { orderNumber, email, total, currency, fallback, orderToken } = input;
  const amount = formatAmount(total, currency);
  const orderLink = orderToken ? buildOrderConfirmationUrl(orderNumber, orderToken) : null;
  const orderLinkHtml = orderLink ? `<p><a href="${orderLink}">View your order</a></p>` : "";

  try {
    const result = await sendTransactionalEmail(
      {
        to: email,
        subject: fallback ? `We received your order ${orderNumber}` : `Payment received — order ${orderNumber}`,
        html: fallback
          ? `<p>Thanks for your order <strong>${orderNumber}</strong> (${amount}). Our team will contact you shortly to confirm payment and delivery.</p>${orderLinkHtml}`
          : `<p>Your payment for order <strong>${orderNumber}</strong> (${amount}) was received. We'll let you know as soon as it ships.</p>${orderLinkHtml}`,
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
}
