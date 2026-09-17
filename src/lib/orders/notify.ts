import { db } from "@/lib/db";
import { sendEmail } from "@/lib/engagement/providers/email";
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
}

function formatAmount(total: number, currency: string): string {
  return `${currency} ${total.toFixed(2)}`;
}

export async function notifyNewOrder(input: NotifyNewOrderInput): Promise<void> {
  const { orderNumber, email, total, currency, fallback } = input;
  const amount = formatAmount(total, currency);

  try {
    const result = await sendEmail({
      to: email,
      subject: fallback ? `We received your order ${orderNumber}` : `Payment received — order ${orderNumber}`,
      html: fallback
        ? `<p>Thanks for your order <strong>${orderNumber}</strong> (${amount}). Our team will contact you shortly to confirm payment and delivery.</p>`
        : `<p>Your payment for order <strong>${orderNumber}</strong> (${amount}) was received. We'll let you know as soon as it ships.</p>`,
    });
    if (!result.ok) {
      console.log(
        `[orders/notify] customer email not sent for ${orderNumber} (provider=${result.provider}): ${result.error ?? "unknown reason"}`,
      );
    }
  } catch (error) {
    console.log(`[orders/notify] customer email threw for ${orderNumber}:`, error);
  }

  try {
    const adminEmail = await getSetting("contact.email");
    if (adminEmail) {
      const result = await sendEmail({
        to: adminEmail,
        subject: `New order ${orderNumber}${fallback ? " (order request — payment pending)" : " (paid)"}`,
        html: `<p>Order <strong>${orderNumber}</strong> from ${email} — ${amount}. ${
          fallback
            ? "Payment has not been collected online; contact the customer to confirm."
            : "Payment received via Razorpay."
        }</p>`,
      });
      if (!result.ok) {
        console.log(
          `[orders/notify] admin email not sent for ${orderNumber} (provider=${result.provider}): ${result.error ?? "unknown reason"}`,
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
