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

export function getOrderTimeline(status: OrderStatus, paymentMethod: PaymentMethod): OrderTimeline {
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
      // create-order.ts creates an ORDER_REQUEST order directly into
      // PROCESSING (it has no online payment step to gate on — see that
      // file's doc comment: `initialStatus = paymentMethod === "ORDER_REQUEST"
      // ? "PROCESSING" : "PENDING_PAYMENT"`), and the transition matrix
      // (status-transitions.ts) never allows PROCESSING -> PAID, so an
      // ORDER_REQUEST order can reach PROCESSING *without* our team ever
      // having confirmed payment yet — unlike a RAZORPAY order, which can
      // only be PROCESSING after actually passing through PAID. The same
      // enum value means something different depending on paymentMethod,
      // so this keeps "confirmed" as the current (not complete) step,
      // with the same "our team will contact you" framing as the
      // PENDING_PAYMENT case above, until the order reaches SHIPPED —
      // which does unambiguously prove it was confirmed and prepared.
      if (paymentMethod === "ORDER_REQUEST") {
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

    case "CANCELLED":
      // Only "Placed" is asserted as fact. CANCELLED is reachable from
      // PENDING_PAYMENT, PAID, *or* PROCESSING (ORDER_STATUS_TRANSITIONS
      // in status-transitions.ts), and this app has no status-history
      // table — so whether payment/processing ever happened before
      // cancellation isn't knowable here, and claiming one would
      // sometimes be false. Same "don't invent what isn't verifiable"
      // rule as the courier-link decision (courier-tracking.ts).
      return {
        steps: [placedStep()],
        terminal: {
          tone: "cancelled",
          label: "Order cancelled",
          description:
            "This order was cancelled. If you were charged, any eligible refund will be issued to your original payment method.",
        },
      };

    case "REFUNDED":
      // Unlike CANCELLED, REFUNDED is reachable only from PAID (see
      // ORDER_STATUS_TRANSITIONS — no other status lists REFUNDED as a
      // next state), so showing "confirmed" as complete here reflects
      // this app's own enforced transition matrix, not a guess.
      return {
        steps: [placedStep(), { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" }],
        terminal: {
          tone: "refunded",
          label: "Order refunded",
          description: "This order was refunded.",
        },
      };

    default: {
      const exhaustiveCheck: never = status;
      throw new Error(`Unhandled OrderStatus: ${String(exhaustiveCheck)}`);
    }
  }
}
