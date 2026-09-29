import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

/**
 * Release-hardening item 2 (Medium parity gap — customer order tracking).
 * Pure status -> timeline mapping, kept free of React/DOM so every
 * OrderStatus can be asserted against directly in a unit test (see
 * timeline.test.ts) without rendering anything. The presentational side
 * (src/components/account/order-timeline.tsx) only turns this data into
 * markup.
 *
 * Requested shape (release brief): "placed -> paid/processing -> shipped
 * -> delivered, plus cancelled/refunded states" — so PAID and PROCESSING
 * are deliberately one combined step ("confirmed"), and CANCELLED /
 * REFUNDED are rendered as a distinct terminal banner rather than as a
 * fifth/sixth position on the forward-moving line.
 *
 * Each status is handled as its own explicit case (not derived from a
 * generic numeric "rank"), the same philosophy status-transitions.ts
 * documents for ORDER_STATUS_TRANSITIONS: the real lifecycle isn't
 * linear, so an explicit per-status mapping is easier to verify than
 * rank arithmetic — and it's what lets this file cover "all of them" the
 * way the release brief asks or fail to compile (see the exhaustiveness
 * check at the bottom).
 */

export type OrderTimelineStepState = "complete" | "current" | "upcoming";

export interface OrderTimelineStep {
  id: "placed" | "confirmed" | "shipped" | "delivered";
  label: string;
  state: OrderTimelineStepState;
  description?: string;
}

export interface OrderTimelineTerminalBanner {
  tone: "cancelled" | "refunded";
  label: string;
  description: string;
}

export interface OrderTimeline {
  /** Forward-moving happy-path steps reached so far. For CANCELLED this
   * is just "Placed" (see that case below for why); for every other
   * status it's the full 4-step line. */
  steps: OrderTimelineStep[];
  /** Set only for CANCELLED/REFUNDED. When set, render this banner
   * instead of continuing the remaining (unreached) steps. */
  terminal: OrderTimelineTerminalBanner | null;
}

function placedStep(): OrderTimelineStep {
  return { id: "placed", label: "Order placed", state: "complete" };
}

/** PAID/PROCESSING share one step ("confirmed"); the label reads
 * differently for an unpaid, manual-invoice ORDER_REQUEST so it never
 * looks like a failed online payment (release brief, item 2). */
function confirmedLabel(paymentMethod: PaymentMethod): string {
  return paymentMethod === "ORDER_REQUEST" ? "Order confirmed" : "Payment confirmed";
}

export function getOrderTimeline(
  status: OrderStatus,
  paymentMethod: PaymentMethod,
  /**
   * F-141 fix (release-hardening order-lifecycle-payment-integrity):
   * whether this order ever actually captured a Razorpay payment
   * (`razorpayPaymentId !== null`) — irrelevant for ORDER_REQUEST, so it
   * only changes the CANCELLED case below, and only for RAZORPAY. Default
   * `true` (unchanged behaviour) so every existing caller/test that
   * doesn't pass it keeps reading exactly as before; the account order
   * page (the only place a shopper actually sees this) passes the real
   * value.
   */
  hasCapturedPayment = true,
  /**
   * F-199 fix: whether `Order.shippedAt`/`deliveredAt` are actually set —
   * real columns (see status-transitions.ts's orderStatusTimestampField),
   * not a guess the way `hasCapturedPayment` sometimes has to be. Only
   * meaningful for REFUNDED and RETURNED, the statuses now reachable
   * *after* shipping (SHIPPED/DELIVERED -> RETURNED -> REFUNDED, see
   * ORDER_STATUS_TRANSITIONS) as well as before it (PAID -> REFUNDED
   * directly). Both default to `false` — "never claim a step happened
   * unless the caller actually says so" — so every existing caller/test
   * that doesn't pass them keeps reading exactly as before (REFUNDED
   * used to be reachable only from PAID, i.e. never shipped).
   */
  wasShipped = false,
  wasDelivered = false,
  wasPaid = false,
): OrderTimeline {
  switch (status) {
    case "PENDING_PAYMENT": {
      const isOrderRequest = paymentMethod === "ORDER_REQUEST";
      return {
        terminal: null,
        steps: [
          placedStep(),
          {
            id: "confirmed",
            label: isOrderRequest ? "Awaiting confirmation" : "Awaiting payment",
            state: "current",
            description: isOrderRequest
              ? "Our team will contact you shortly to confirm payment and delivery for this order."
              : "We haven't received payment for this order yet.",
          },
          { id: "shipped", label: "Shipped", state: "upcoming" },
          { id: "delivered", label: "Delivered", state: "upcoming" },
        ],
      };
    }

    case "PAID":
      return {
        terminal: null,
        steps: [
          placedStep(),
          {
            id: "confirmed",
            label: confirmedLabel(paymentMethod),
            state: "current",
            description: "Getting your order ready to ship.",
          },
          { id: "shipped", label: "Shipped", state: "upcoming" },
          { id: "delivered", label: "Delivered", state: "upcoming" },
        ],
      };

    case "PROCESSING": {
      // Manual orders begin in PROCESSING before payment. Once the admin
      // records payment, paidAt remains set even if the order returns to
      // PROCESSING, so the customer sees the confirmed state.
      if (paymentMethod === "ORDER_REQUEST" && !wasPaid) {
        return {
          terminal: null,
          steps: [
            placedStep(),
            {
              id: "confirmed",
              label: "Awaiting confirmation",
              state: "current",
              description: "Our team will contact you shortly to confirm payment and delivery for this order.",
            },
            { id: "shipped", label: "Shipped", state: "upcoming" },
            { id: "delivered", label: "Delivered", state: "upcoming" },
          ],
        };
      }
      return {
        terminal: null,
        steps: [
          placedStep(),
          { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" },
          {
            id: "shipped",
            label: "Shipped",
            state: "current",
            description: "Your order is being packed and prepared for shipment.",
          },
          { id: "delivered", label: "Delivered", state: "upcoming" },
        ],
      };
    }

    case "SHIPPED":
      return {
        terminal: null,
        steps: [
          placedStep(),
          { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" },
          { id: "shipped", label: "Shipped", state: "complete" },
          { id: "delivered", label: "Delivered", state: "current", description: "On its way to you." },
        ],
      };

    case "DELIVERED":
      return {
        terminal: null,
        steps: [
          placedStep(),
          { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" },
          { id: "shipped", label: "Shipped", state: "complete" },
          { id: "delivered", label: "Delivered", state: "complete" },
        ],
      };

    case "CANCELLED": {
      // Only "Placed" is asserted as fact. CANCELLED is reachable from
      // PENDING_PAYMENT, PAID, *or* PROCESSING (ORDER_STATUS_TRANSITIONS
      // in status-transitions.ts), and this app has no status-history
      // table — so whether payment/processing ever happened before
      // cancellation isn't knowable here, and claiming one would
      // sometimes be false. Same "don't invent what isn't verifiable"
      // rule as the courier-link decision (courier-tracking.ts).
      //
      // F-141 fix: a RAZORPAY order that reached CANCELLED without ever
      // capturing a payment (an abandoned/failed checkout attempt, per
      // create-order.ts and the stale-order cron) is the one case this
      // *does* know for certain — and "any eligible refund will be
      // issued" is actively alarming/wrong copy for a shopper who was
      // never actually charged.
      const neverPaid = paymentMethod === "RAZORPAY" && !hasCapturedPayment;
      return {
        steps: [placedStep()],
        terminal: {
          tone: "cancelled",
          label: neverPaid ? "Payment not completed" : "Order cancelled",
          description: neverPaid
            ? "Payment was not completed for this order, so no charge was made. You can place a new order any time."
            : "This order was cancelled. If you were charged, any eligible refund will be issued to your original payment method.",
        },
      };
    }

    case "REFUNDED": {
      // F-199 fix: two different journeys reach REFUNDED now
      // (ORDER_STATUS_TRANSITIONS) — PAID -> REFUNDED directly (refunded
      // before ever shipping) or RETURNED -> REFUNDED (shipped, and
      // possibly delivered, before being sent back and refunded).
      // wasShipped/wasDelivered are real Order columns, so — unlike
      // CANCELLED's hasCapturedPayment hedge — the extra steps below
      // state a fact rather than guess one.
      const steps: OrderTimelineStep[] = [
        placedStep(),
        { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" },
      ];
      if (wasShipped) steps.push({ id: "shipped", label: "Shipped", state: "complete" });
      if (wasDelivered) steps.push({ id: "delivered", label: "Delivered", state: "complete" });
      return {
        steps,
        terminal: {
          tone: "refunded",
          label: "Order refunded",
          description: "This order was refunded.",
        },
      };
    }

    case "RETURNED": {
      // F-199 fix: reachable only from SHIPPED or DELIVERED
      // (ORDER_STATUS_TRANSITIONS), so "shipped" is always a fact here —
      // only "delivered" depends on which of the two it came from.
      const steps: OrderTimelineStep[] = [
        placedStep(),
        { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" },
        { id: "shipped", label: "Shipped", state: "complete" },
      ];
      if (wasDelivered) steps.push({ id: "delivered", label: "Delivered", state: "complete" });
      return {
        steps,
        // "refunded" tone (amber/RotateCcw in OrderTimelineView) reads
        // better for a return-in-progress than "cancelled" (red/XCircle)
        // — nothing about a return itself is an error state the way a
        // cancellation is.
        terminal: {
          tone: "refunded",
          label: "Order returned",
          description: "This order was returned. Any eligible refund will be issued to your original payment method.",
        },
      };
    }

    default: {
      const exhaustiveCheck: never = status;
      throw new Error(`Unhandled OrderStatus: ${String(exhaustiveCheck)}`);
    }
  }
}
