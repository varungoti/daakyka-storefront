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
  /** F-300 fix: when this step was actually reached — only ever set on a
   * "complete" step whose real `Order` timestamp is known (see
   * OrderTimelineMilestones); the presentational view renders it in IST. */
  at?: Date;
}

/**
 * F-199 / F-300 fix: the `Order` timestamp columns the timeline reads
 * (status-transitions.ts's orderStatusTimestampField is what writes them)
 * — real facts, not guesses. A step is only dated, and a post-shipping
 * REFUNDED/RETURNED only claims its shipped/delivered steps, when the
 * matching column is set; `null`/omitted means "unknown", never "didn't
 * happen" (an order that shipped before these columns existed has no
 * `shippedAt`).
 */
export interface OrderTimelineMilestones {
  placedAt?: Date | null;
  paidAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

export interface OrderTimelineTerminalBanner {
  tone: "cancelled" | "refunded";
  label: string;
  description: string;
}

export interface OrderTimeline {
  /** Forward-moving happy-path steps reached so far. For CANCELLED this
   * is just "Placed" (see that case below for why); for REFUNDED/RETURNED
   * only the steps the order really got through; for every other status
   * it's the full 4-step line. */
  steps: OrderTimelineStep[];
  /** Set only for CANCELLED/REFUNDED/RETURNED. When set, render this
   * banner instead of continuing the remaining (unreached) steps. */
  terminal: OrderTimelineTerminalBanner | null;
}

/** Attaches a milestone's date to a step that's already complete. */
function dated(step: OrderTimelineStep, at: Date | null | undefined): OrderTimelineStep {
  return at ? { ...step, at } : step;
}

function placedStep(milestones: OrderTimelineMilestones): OrderTimelineStep {
  return dated({ id: "placed", label: "Order placed", state: "complete" }, milestones.placedAt);
}

/** PAID/PROCESSING share one step ("confirmed"); the label reads
 * differently for an unpaid, manual-invoice ORDER_REQUEST so it never
 * looks like a failed online payment (release brief, item 2). */
function confirmedLabel(paymentMethod: PaymentMethod): string {
  return paymentMethod === "ORDER_REQUEST" ? "Order confirmed" : "Payment confirmed";
}

/** A "confirmed" step that has already happened. Dated by `paidAt` — the
 * moment payment was received/recorded is the moment the order was
 * confirmed (an ORDER_REQUEST order that shipped with no payment recorded
 * simply has no date). */
function confirmedStep(paymentMethod: PaymentMethod, milestones: OrderTimelineMilestones): OrderTimelineStep {
  return dated(
    { id: "confirmed", label: confirmedLabel(paymentMethod), state: "complete" },
    milestones.paidAt,
  );
}

function shippedStep(milestones: OrderTimelineMilestones): OrderTimelineStep {
  return dated({ id: "shipped", label: "Shipped", state: "complete" }, milestones.shippedAt);
}

function deliveredStep(milestones: OrderTimelineMilestones): OrderTimelineStep {
  return dated({ id: "delivered", label: "Delivered", state: "complete" }, milestones.deliveredAt);
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
   * F-199 / F-300 fix: the order's real timestamp columns — see
   * OrderTimelineMilestones. They date the completed steps, tell an
   * ORDER_REQUEST order whose payment an admin has recorded (`paidAt`)
   * from one still awaiting confirmation, and decide which post-shipping
   * steps a REFUNDED order (now reachable from SHIPPED/DELIVERED/RETURNED
   * as well as PAID) can truthfully claim. Defaults to "nothing known" —
   * never claim a step happened unless the caller actually says so — so a
   * caller that omits it reads exactly as before.
   */
  milestones: OrderTimelineMilestones = {},
): OrderTimeline {
  switch (status) {
    case "PENDING_PAYMENT": {
      const isOrderRequest = paymentMethod === "ORDER_REQUEST";
      return {
        terminal: null,
        steps: [
          placedStep(milestones),
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
          placedStep(milestones),
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
      if (paymentMethod === "ORDER_REQUEST" && !milestones.paidAt) {
        return {
          terminal: null,
          steps: [
            placedStep(milestones),
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
          placedStep(milestones),
          confirmedStep(paymentMethod, milestones),
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
          placedStep(milestones),
          confirmedStep(paymentMethod, milestones),
          shippedStep(milestones),
          { id: "delivered", label: "Delivered", state: "current", description: "On its way to you." },
        ],
      };

    case "DELIVERED":
      return {
        terminal: null,
        steps: [
          placedStep(milestones),
          confirmedStep(paymentMethod, milestones),
          shippedStep(milestones),
          deliveredStep(milestones),
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
        steps: [placedStep(milestones)],
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
      // F-199 fix: REFUNDED is reachable from PAID (refunded before ever
      // shipping) and, now, from SHIPPED/DELIVERED/RETURNED
      // (ORDER_STATUS_TRANSITIONS) — "confirmed" is always a fact (every
      // path passes through a payment), but shipped/delivered only when
      // the real `shippedAt`/`deliveredAt` columns say so, so — unlike
      // CANCELLED's hasCapturedPayment hedge — the extra steps below state
      // a fact rather than guess one.
      const steps: OrderTimelineStep[] = [placedStep(milestones), confirmedStep(paymentMethod, milestones)];
      if (milestones.shippedAt) steps.push(shippedStep(milestones));
      if (milestones.deliveredAt) steps.push(deliveredStep(milestones));
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
        placedStep(milestones),
        confirmedStep(paymentMethod, milestones),
        shippedStep(milestones),
      ];
      if (milestones.deliveredAt) steps.push(deliveredStep(milestones));
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

export type OrderStatusHeroIcon = "clock" | "check" | "truck" | "cancelled" | "refunded";

export interface OrderStatusHero {
  icon: OrderStatusHeroIcon;
  label: string;
}

/**
 * F-120 fix: the heading and icon at the top of the order page
 * (src/app/order/[number]/page.tsx — the page a guest reaches from their
 * confirmation email) used to be a hard-coded "Order confirmed" with a
 * check mark, whatever the order's status: a cancelled, refunded or
 * still-unpaid order read "Order confirmed" directly above "Cancelled".
 * Pure and keyed exhaustively by status (the `never` check below fails the
 * type-check when the schema grows a new one) so each case is directly
 * unit-testable without rendering the page; the page only maps `icon` to
 * a lucide component. Mirrors getOrderTimeline's own framing — in
 * particular an ORDER_REQUEST order only reads "confirmed" once an admin
 * has recorded its payment (`paid`, from `Order.paidAt`), since
 * create-order.ts puts it into PROCESSING before anyone has confirmed it.
 */
export function getOrderStatusHero(status: OrderStatus, paymentMethod: PaymentMethod, paid = false): OrderStatusHero {
  switch (status) {
    case "PENDING_PAYMENT":
      return paymentMethod === "ORDER_REQUEST"
        ? { icon: "clock", label: "Order received" }
        : { icon: "clock", label: "Awaiting payment" };
    case "PAID":
      return { icon: "check", label: "Order confirmed" };
    case "PROCESSING":
      return paymentMethod === "ORDER_REQUEST" && !paid
        ? { icon: "clock", label: "Order received" }
        : { icon: "check", label: "Order confirmed" };
    case "SHIPPED":
      return { icon: "truck", label: "Order shipped" };
    case "DELIVERED":
      return { icon: "check", label: "Order delivered" };
    case "CANCELLED":
      return { icon: "cancelled", label: "Order cancelled" };
    case "REFUNDED":
      return { icon: "refunded", label: "Order refunded" };
    case "RETURNED":
      return { icon: "refunded", label: "Order returned" };
    default: {
      const exhaustiveCheck: never = status;
      throw new Error(`Unhandled OrderStatus: ${String(exhaustiveCheck)}`);
    }
  }
}
