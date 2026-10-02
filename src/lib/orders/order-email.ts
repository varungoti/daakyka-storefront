import type { PaymentMethod } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/email/html";
import {
  button,
  EMAIL_COLORS,
  emailSiteUrl,
  formatEmailMoney,
  paragraph,
  renderEmailLayout,
  type EmailFooter,
} from "@/lib/email/layout";
import { getCourierTrackingUrl } from "@/lib/orders/courier-tracking";

/**
 * F-041: the order emails used to be one sentence — no items, no address, no
 * totals, "INR 1198.00" for money, no store contact details, and (because no
 * explicit text part was sent) a plain-text version with no links. This
 * builds the real thing: a branded body with an item table, the shipping
 * address and a subtotal/shipping/discount/total breakdown in ₹ with Indian
 * digit grouping, plus an explicit text part that spells out every URL.
 *
 * The outbox stores each message as it was rendered at queue time (the drain
 * cron can't re-render — see src/lib/engagement/outbox.ts), so everything is
 * built here, before sendTransactionalEmail is called. Every value that came
 * from a shopper or an admin (names, address, product names, tracking
 * numbers) goes through escapeHtml.
 */

export interface OrderEmailItem {
  name: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
}

export interface OrderEmailData {
  number: string;
  email: string;
  phone: string | null;
  currency: string;
  paymentMethod: PaymentMethod;
  items: OrderEmailItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  discountCode: string | null;
  total: number;
  /** Recipient name followed by the address lines — empty when the stored
   * address is missing or unreadable. */
  addressLines: string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Reads `Order.shippingAddress` (JSON written by checkout's
 * shippingAddressSchema) defensively — a legacy or malformed row yields no
 * lines rather than an exception. */
export function formatAddressLines(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const address = raw as Record<string, unknown>;
  const region = [text(address.state), text(address.pincode)].filter(Boolean).join(" ");
  const country = text(address.country);
  return [
    text(address.name),
    text(address.line1),
    text(address.line2),
    [text(address.city), region].filter(Boolean).join(", "),
    country === "IN" ? "India" : country,
  ].filter(Boolean);
}

/** Loads what the order emails need. Never throws — a missing order or a DB
 * hiccup returns null and the caller falls back to a summary-less email, so
 * a render problem can never stop the notification going out. */
export async function loadOrderEmailData(orderId: string): Promise<OrderEmailData | null> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) return null;
    return {
      number: order.number,
      email: order.email,
      phone: order.phone,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      items: order.items.map((item) => ({
        name: item.productName,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
      subtotal: Number(order.subtotal),
      shipping: Number(order.shipping),
      discount: Number(order.discount),
      discountCode: order.discountCode,
      total: Number(order.total),
      addressLines: formatAddressLines(order.shippingAddress),
    };
  } catch (error) {
    console.log(`[orders/email] could not load order ${orderId} for the email summary:`, error instanceof Error ? error.message : error);
    return null;
  }
}

const FONT = "Arial,Helvetica,sans-serif";
const CELL = `padding:8px 0;border-bottom:1px solid ${EMAIL_COLORS.border};font-family:${FONT};font-size:14px;line-height:1.45;color:${EMAIL_COLORS.ink};`;

function moneyRow(label: string, value: string, strong = false): string {
  const weight = strong ? "font-weight:700;font-size:16px;" : "";
  return `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${EMAIL_COLORS.ink};${weight}">${label}</td><td align="right" style="padding:6px 0;font-family:${FONT};font-size:14px;color:${EMAIL_COLORS.ink};${weight}">${value}</td></tr>`;
}

/** The item table, totals and shipping address as one HTML block plus its
 * plain-text twin. */
export function renderOrderSummary(order: OrderEmailData): { html: string; text: string } {
  const money = (amount: number) => formatEmailMoney(amount, order.currency);

  const itemRows = order.items
    .map(
      (item) =>
        `<tr><td style="${CELL}"><strong>${escapeHtml(item.name)}</strong><br><span style="color:${EMAIL_COLORS.muted};font-size:13px;">${
          item.variantLabel ? `${escapeHtml(item.variantLabel)} &middot; ` : ""
        }Qty ${item.quantity} &middot; ${money(item.unitPrice)} each</span></td><td align="right" valign="top" style="${CELL}white-space:nowrap;">${money(item.unitPrice * item.quantity)}</td></tr>`,
    )
    .join("");

  const totals = [
    moneyRow("Subtotal", money(order.subtotal)),
    moneyRow("Shipping", order.shipping === 0 ? "Free" : money(order.shipping)),
    order.discount > 0
      ? moneyRow(`Discount${order.discountCode ? ` (${escapeHtml(order.discountCode)})` : ""}`, `&minus;${money(order.discount)}`)
      : "",
    `<tr><td colspan="2" style="border-top:1px solid ${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</td></tr>`,
    moneyRow("Total", money(order.total), true),
  ].join("");

  const addressHtml = order.addressLines.length
    ? `<p style="margin:16px 0 4px;font-family:${FONT};font-size:13px;font-weight:700;color:${EMAIL_COLORS.muted};text-transform:uppercase;letter-spacing:0.4px;">Shipping to</p><p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.ink};">${order.addressLines
        .map(escapeHtml)
        .join("<br>")}${order.phone ? `<br>Phone: ${escapeHtml(order.phone)}` : ""}</p>`
    : "";

  const html = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 8px;">${itemRows}</table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 8px;">${totals}</table>${addressHtml}`;

  const lines = [
    "Items",
    ...order.items.map((item) => {
      const label = item.variantLabel ? ` (${item.variantLabel})` : "";
      return `- ${item.name}${label} x ${item.quantity} - ${money(item.unitPrice * item.quantity)}`;
    }),
    "",
    `Subtotal: ${money(order.subtotal)}`,
    `Shipping: ${order.shipping === 0 ? "Free" : money(order.shipping)}`,
    ...(order.discount > 0 ? [`Discount${order.discountCode ? ` (${order.discountCode})` : ""}: -${money(order.discount)}`] : []),
    `Total: ${money(order.total)}`,
  ];
  if (order.addressLines.length) {
    lines.push("", "Shipping to:", ...order.addressLines);
    if (order.phone) lines.push(`Phone: ${order.phone}`);
  }

  return { html, text: lines.join("\n") };
}

export interface CustomerOrderEmailInput {
  orderNumber: string;
  total: number;
  currency: string;
  /** ORDER_REQUEST — no online payment taken yet. */
  fallback: boolean;
  /** A payment was captured but a line lost the stock race (F-283). */
  stockConflict: boolean;
  orderLink: string;
  order: OrderEmailData | null;
  footer: EmailFooter;
}

/** The customer's "we received your order / payment received" email. */
export function renderCustomerOrderEmail(input: CustomerOrderEmailInput): { subject: string; html: string; text: string } {
  const { orderNumber, fallback, stockConflict } = input;
  const amount = formatEmailMoney(input.total, input.currency);

  const subject = stockConflict
    ? `Payment received — order ${orderNumber} (stock issue)`
    : fallback
      ? `We received your order ${orderNumber}`
      : `Payment received — order ${orderNumber}`;
  const heading = fallback && !stockConflict ? "Thanks for your order" : "Payment received";

  // F-283: never claim "we'll let you know as soon as it ships" when a line
  // actually lost the stock race.
  const intro = stockConflict
    ? `Your payment for order ${orderNumber} (${amount}) was received, but one or more items in this order sold out just before your payment completed. Our team will contact you shortly about a refund for the affected item(s) or a replacement.`
    : fallback
      ? `Thanks for your order ${orderNumber} (${amount}). Our team will contact you shortly to confirm payment and delivery.`
      : `Your payment for order ${orderNumber} (${amount}) was received. We'll let you know as soon as it ships.`;
  const introHtml = escapeHtml(intro).replace(escapeHtml(orderNumber), `<strong>${escapeHtml(orderNumber)}</strong>`);

  const summary = input.order ? renderOrderSummary(input.order) : null;
  // F-125: prices are tax-inclusive; the seller and (once entered) GSTIN are
  // named in the footer every email carries.
  const taxNote = "Prices are inclusive of all taxes.";

  const { html, text } = renderEmailLayout({
    subject,
    heading,
    preheader: intro,
    bodyHtml:
      paragraph(introHtml) +
      (summary?.html ?? "") +
      button("View your order", input.orderLink) +
      paragraph(`<span style="font-size:12px;color:${EMAIL_COLORS.muted};">${taxNote}</span>`),
    bodyText: [intro, summary?.text, `View your order: ${input.orderLink}`, taxNote].filter(Boolean).join("\n\n"),
    footer: input.footer,
  });
  return { subject, html, text };
}

export interface AdminOrderEmailInput {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  total: number;
  currency: string;
  fallback: boolean;
  order: OrderEmailData | null;
  footer: EmailFooter;
}

/** The "new order" alert to the store's contact address — links straight to
 * the order in the admin. */
export function renderAdminOrderEmail(input: AdminOrderEmailInput): { subject: string; html: string; text: string } {
  const { orderNumber, fallback } = input;
  const amount = formatEmailMoney(input.total, input.currency);
  const subject = `New order ${orderNumber}${fallback ? " (order request — payment pending)" : " (paid)"}`;
  const adminUrl = `${emailSiteUrl()}/admin/orders/${encodeURIComponent(input.orderId)}`;
  const paymentLine = fallback
    ? "Payment has not been collected online; contact the customer to confirm."
    : "Payment received via Razorpay.";
  const lead = `Order ${orderNumber} from ${input.customerEmail} — ${amount}. ${paymentLine}`;
  const summary = input.order ? renderOrderSummary(input.order) : null;

  const { html, text } = renderEmailLayout({
    subject,
    heading: fallback ? "New order request" : "New paid order",
    bodyHtml:
      paragraph(
        `Order <strong>${escapeHtml(orderNumber)}</strong> from ${escapeHtml(input.customerEmail)} &mdash; ${escapeHtml(amount)}. ${escapeHtml(paymentLine)}`,
      ) +
      (summary?.html ?? "") +
      button("Open order in admin", adminUrl),
    bodyText: [lead, summary?.text, `Open order in admin: ${adminUrl}`].filter(Boolean).join("\n\n"),
    footer: input.footer,
  });
  return { subject, html, text };
}

export interface OrderStatusEmailInput {
  orderNumber: string;
  toStatus: "SHIPPED" | "CANCELLED" | "REFUNDED";
  trackingNumber?: string | null;
  courier?: string | null;
  paymentMethod: PaymentMethod;
  /** Mirrors getOrderTimeline's `hasCapturedPayment`; see notify.ts. */
  hasCapturedPayment: boolean;
  footer: EmailFooter;
}

/** Shipped / cancelled / refunded customer emails. */
export function renderOrderStatusEmail(
  input: OrderStatusEmailInput,
): { subject: string; html: string; text: string } {
  const { orderNumber, toStatus } = input;
  let subject: string;
  let heading: string;
  const parts: { html: string; text: string }[] = [];
  let trackingButton = "";

  if (toStatus === "SHIPPED") {
    subject = `Your order ${orderNumber} has shipped`;
    heading = "Your order has shipped";
    parts.push({
      html: paragraph(`Good news &mdash; your order <strong>${escapeHtml(orderNumber)}</strong> has shipped.`),
      text: `Good news - your order ${orderNumber} has shipped.`,
    });
    if (input.trackingNumber) {
      const courierSuffix = input.courier ? ` via ${input.courier}` : "";
      const trackingUrl = getCourierTrackingUrl(input.courier, input.trackingNumber);
      parts.push({
        html: paragraph(
          `Tracking number${escapeHtml(courierSuffix)}: ${
            trackingUrl
              ? `<a href="${escapeHtml(trackingUrl)}">${escapeHtml(input.trackingNumber)}</a>`
              : `<strong>${escapeHtml(input.trackingNumber)}</strong>`
          }`,
        ),
        text: `Tracking number${courierSuffix}: ${input.trackingNumber}${trackingUrl ? `\nTrack it: ${trackingUrl}` : ""}`,
      });
      if (trackingUrl) trackingButton = button("Track your shipment", trackingUrl);
    }
  } else if (toStatus === "CANCELLED") {
    subject = `Your order ${orderNumber} was cancelled`;
    heading = "Your order was cancelled";
    // Same "don't claim what isn't verifiable" rule as getOrderTimeline's
    // CANCELLED case — only a RAZORPAY order that never captured a payment
    // is known for certain to have taken no money.
    const neverPaid = input.paymentMethod === "RAZORPAY" && !input.hasCapturedPayment;
    const sentence = neverPaid
      ? `Your order ${orderNumber} has been cancelled. Payment was not completed, so no charge was made — you can place a new order any time.`
      : `Your order ${orderNumber} has been cancelled. If you were charged, any eligible refund will be issued to your original payment method.`;
    parts.push({
      html: paragraph(escapeHtml(sentence).replace(escapeHtml(orderNumber), `<strong>${escapeHtml(orderNumber)}</strong>`)),
      text: sentence,
    });
  } else {
    subject = `Your order ${orderNumber} was refunded`;
    heading = "Your order was refunded";
    const sentence = `Your order ${orderNumber} has been refunded. Please allow a few business days for the amount to reflect in your original payment method.`;
    parts.push({
      html: paragraph(escapeHtml(sentence).replace(escapeHtml(orderNumber), `<strong>${escapeHtml(orderNumber)}</strong>`)),
      text: sentence,
    });
  }

  const { html, text } = renderEmailLayout({
    subject,
    heading,
    bodyHtml: parts.map((part) => part.html).join("") + trackingButton,
    bodyText: parts.map((part) => part.text).join("\n\n"),
    footer: input.footer,
  });
  return { subject, html, text };
}
