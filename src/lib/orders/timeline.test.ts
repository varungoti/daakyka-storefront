import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrderStatusHero, getOrderTimeline } from "@/lib/orders/timeline";
import { orderStatusValues } from "@/lib/orders/admin-orders";
import type { OrderStatus } from "@/generated/prisma/client";

/**
 * Release-hardening item 2 — covers every OrderStatus (read straight off
 * orderStatusValues, itself sourced from the prisma schema enum) for both
 * payment methods, per the release brief's "cover all of them" test
 * requirement. Presentation (src/components/account/order-timeline.tsx)
 * is intentionally not exercised here — this only asserts the pure data
 * mapping.
 */
describe("getOrderTimeline", () => {
  it("covers every OrderStatus value without throwing, for both payment methods", () => {
    for (const status of orderStatusValues) {
      for (const paymentMethod of ["RAZORPAY", "ORDER_REQUEST"] as const) {
        const timeline = getOrderTimeline(status, paymentMethod);
        assert.ok(timeline.steps.length > 0, `${status}/${paymentMethod} should render at least one step`);
      }
    }
  });

  it("PENDING_PAYMENT + RAZORPAY reads as an in-progress payment, not a failure", () => {
    const timeline = getOrderTimeline("PENDING_PAYMENT", "RAZORPAY");
    assert.equal(timeline.terminal, null);
    assert.equal(timeline.steps[0].state, "complete");
    assert.equal(timeline.steps[1].id, "confirmed");
    assert.equal(timeline.steps[1].state, "current");
    assert.match(timeline.steps[1].label, /awaiting payment/i);
    assert.equal(timeline.steps[2].state, "upcoming");
    assert.equal(timeline.steps[3].state, "upcoming");
  });

  it("PENDING_PAYMENT + ORDER_REQUEST reads as a manual invoice, never a failed payment", () => {
    const timeline = getOrderTimeline("PENDING_PAYMENT", "ORDER_REQUEST");
    assert.equal(timeline.terminal, null);
    const confirmedStep = timeline.steps.find((step) => step.id === "confirmed");
    assert.ok(confirmedStep);
    assert.doesNotMatch(confirmedStep!.label.toLowerCase(), /fail|error|declined/);
    assert.match(confirmedStep!.label, /awaiting confirmation/i);
    assert.match(confirmedStep!.description ?? "", /contact you/i);
  });

  it("PAID marks placed complete and confirmed as the current step", () => {
    const timeline = getOrderTimeline("PAID", "RAZORPAY");
    assert.equal(timeline.terminal, null);
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "current", "upcoming", "upcoming"],
    );
  });

  it("PROCESSING marks confirmed complete and shipped as current", () => {
    const timeline = getOrderTimeline("PROCESSING", "RAZORPAY");
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "complete", "current", "upcoming"],
    );
  });

  it("PROCESSING + ORDER_REQUEST does NOT claim 'confirmed' is complete — create-order.ts puts these orders straight into PROCESSING with no payment-confirmation step, so it must keep reading as awaiting our team, not as already packed", () => {
    const timeline = getOrderTimeline("PROCESSING", "ORDER_REQUEST");
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "current", "upcoming", "upcoming"],
    );
    const confirmedStep = timeline.steps.find((s) => s.id === "confirmed");
    assert.ok(confirmedStep);
    assert.doesNotMatch(confirmedStep!.label.toLowerCase(), /fail|error|declined/);
    assert.match(confirmedStep!.description ?? "", /contact you/i);
  });

  it("PROCESSING + RAZORPAY (by contrast) does claim 'confirmed' is complete, since RAZORPAY can only reach PROCESSING by first passing through PAID", () => {
    const timeline = getOrderTimeline("PROCESSING", "RAZORPAY");
    const confirmedStep = timeline.steps.find((s) => s.id === "confirmed");
    assert.equal(confirmedStep?.state, "complete");
  });

  // F-199 fix: an admin can now record an order-request's payment
  // (PROCESSING -> PAID), after which it may go back to PROCESSING to be
  // packed — `paidAt` is what tells that order from one never confirmed.
  it("F-199: PROCESSING + ORDER_REQUEST shows confirmation after payment was recorded (paidAt set)", () => {
    const paidAt = new Date("2026-09-30T08:00:00Z");
    const timeline = getOrderTimeline("PROCESSING", "ORDER_REQUEST", true, { paidAt });
    assert.equal(timeline.steps.find((step) => step.id === "confirmed")?.state, "complete");
    assert.equal(timeline.steps.find((step) => step.id === "shipped")?.state, "current");
    assert.equal(timeline.steps.find((step) => step.id === "confirmed")?.at, paidAt);
    assert.doesNotMatch(JSON.stringify(timeline), /contact you/i);
  });

  it("F-199: PAID + ORDER_REQUEST (payment just recorded) reads as confirmed and getting ready — never 'awaiting confirmation'", () => {
    const timeline = getOrderTimeline("PAID", "ORDER_REQUEST", true, { paidAt: new Date() });
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "current", "upcoming", "upcoming"],
    );
    assert.doesNotMatch(timeline.steps[1].label, /awaiting/i);
  });

  it("SHIPPED marks delivered as the current (final) step", () => {
    const timeline = getOrderTimeline("SHIPPED", "RAZORPAY");
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "complete", "complete", "current"],
    );
  });

  it("DELIVERED marks every step complete", () => {
    const timeline = getOrderTimeline("DELIVERED", "RAZORPAY");
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "complete", "complete", "complete"],
    );
  });

  it("CANCELLED only asserts 'placed' as fact and renders a terminal banner", () => {
    const timeline = getOrderTimeline("CANCELLED", "RAZORPAY");
    assert.equal(timeline.steps.length, 1);
    assert.equal(timeline.steps[0].id, "placed");
    assert.equal(timeline.steps[0].state, "complete");
    assert.ok(timeline.terminal);
    assert.equal(timeline.terminal!.tone, "cancelled");
  });

  it("REFUNDED with no shipping timestamps asserts only placed+confirmed (the PAID -> REFUNDED journey) and renders a terminal banner", () => {
    const timeline = getOrderTimeline("REFUNDED", "RAZORPAY");
    assert.equal(timeline.steps.length, 2);
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "complete"],
    );
    assert.ok(timeline.terminal);
    assert.equal(timeline.terminal!.tone, "refunded");
  });

  // F-199 fix: RETURNED is now reachable from SHIPPED or DELIVERED.
  it("RETURNED asserts placed+confirmed+shipped as fact (reachable only from SHIPPED/DELIVERED) and renders a terminal banner", () => {
    const timeline = getOrderTimeline("RETURNED", "RAZORPAY");
    assert.deepEqual(
      timeline.steps.map((s) => s.id),
      ["placed", "confirmed", "shipped"],
    );
    assert.ok(timeline.steps.every((s) => s.state === "complete"));
    assert.ok(timeline.terminal);
    assert.equal(timeline.terminal!.tone, "refunded");
    assert.match(timeline.terminal!.label, /returned/i);
  });

  it("RETURNED additionally asserts 'delivered' complete when deliveredAt is set (DELIVERED -> RETURNED, not SHIPPED -> RETURNED)", () => {
    const timeline = getOrderTimeline("RETURNED", "RAZORPAY", true, {
      shippedAt: new Date("2026-09-20T10:00:00Z"),
      deliveredAt: new Date("2026-09-24T10:00:00Z"),
    });
    assert.deepEqual(
      timeline.steps.map((s) => s.id),
      ["placed", "confirmed", "shipped", "delivered"],
    );
    assert.ok(timeline.steps.every((s) => s.state === "complete"));
  });

  // F-199 fix: REFUNDED is now also reachable from SHIPPED, DELIVERED and
  // RETURNED (shipped, and possibly delivered, before being refunded) — not
  // only from PAID.
  it("REFUNDED includes shipped/delivered steps only when shippedAt/deliveredAt say so", () => {
    const shippedAt = new Date("2026-09-20T10:00:00Z");
    const deliveredAt = new Date("2026-09-24T10:00:00Z");
    const neverShipped = getOrderTimeline("REFUNDED", "RAZORPAY");
    assert.deepEqual(
      neverShipped.steps.map((s) => s.id),
      ["placed", "confirmed"],
    );

    const shippedNotDelivered = getOrderTimeline("REFUNDED", "RAZORPAY", true, { shippedAt });
    assert.deepEqual(
      shippedNotDelivered.steps.map((s) => s.id),
      ["placed", "confirmed", "shipped"],
    );

    const shippedAndDelivered = getOrderTimeline("REFUNDED", "RAZORPAY", true, { shippedAt, deliveredAt });
    assert.deepEqual(
      shippedAndDelivered.steps.map((s) => s.id),
      ["placed", "confirmed", "shipped", "delivered"],
    );
    assert.equal(shippedAndDelivered.terminal!.tone, "refunded");
  });

  it("never claims a step happened that the transition matrix contradicts (CANCELLED vs REFUNDED asymmetry)", () => {
    // CANCELLED is reachable *before* payment (PENDING_PAYMENT -> CANCELLED
    // per ORDER_STATUS_TRANSITIONS), so it must not claim "confirmed"
    // happened. REFUNDED is only reachable from a paid order (PAID,
    // SHIPPED, DELIVERED or RETURNED), so it may.
    const cancelled = getOrderTimeline("CANCELLED", "RAZORPAY");
    const refunded = getOrderTimeline("REFUNDED", "RAZORPAY");
    assert.ok(!cancelled.steps.some((s) => s.id === "confirmed"));
    assert.ok(refunded.steps.some((s) => s.id === "confirmed"));
  });

  // F-141 fix (release-hardening order-lifecycle-payment-integrity): a
  // RAZORPAY order that never actually captured a payment (an abandoned
  // checkout the stale-order cron later auto-cancels) must not be told
  // "any eligible refund will be issued" — nothing was ever charged.
  it("F-141: a never-paid RAZORPAY order (hasCapturedPayment=false) gets neutral 'payment not completed' copy, not refund wording", () => {
    const neverPaid = getOrderTimeline("CANCELLED", "RAZORPAY", false);
    assert.equal(neverPaid.terminal!.tone, "cancelled");
    assert.equal(neverPaid.terminal!.label, "Payment not completed");
    assert.doesNotMatch(neverPaid.terminal!.description, /refund/i);
  });

  it("F-141: every other CANCELLED case keeps the original refund-eligible wording", () => {
    // Default (omitted) stays exactly as before this fix existed —
    // existing callers that don't pass the new argument are unaffected.
    const defaulted = getOrderTimeline("CANCELLED", "RAZORPAY");
    assert.equal(defaulted.terminal!.label, "Order cancelled");
    assert.match(defaulted.terminal!.description, /refund/i);

    // A RAZORPAY order that *did* capture a payment before being cancelled.
    const paidThenCancelled = getOrderTimeline("CANCELLED", "RAZORPAY", true);
    assert.equal(paidThenCancelled.terminal!.label, "Order cancelled");
    assert.match(paidThenCancelled.terminal!.description, /refund/i);

    // hasCapturedPayment is irrelevant for ORDER_REQUEST — it has no
    // online payment step to have skipped.
    const orderRequestCancelled = getOrderTimeline("CANCELLED", "ORDER_REQUEST", false);
    assert.equal(orderRequestCancelled.terminal!.label, "Order cancelled");
    assert.match(orderRequestCancelled.terminal!.description, /refund/i);
  });

  // F-300 fix: the timeline used to carry no dates at all.
  it("F-300: dates each completed step from the order's real timestamps, and never dates an incomplete one", () => {
    const placedAt = new Date("2026-09-18T05:00:00Z");
    const paidAt = new Date("2026-09-18T05:10:00Z");
    const shippedAt = new Date("2026-09-20T10:00:00Z");
    const deliveredAt = new Date("2026-09-24T10:00:00Z");

    const delivered = getOrderTimeline("DELIVERED", "RAZORPAY", true, { placedAt, paidAt, shippedAt, deliveredAt });
    assert.deepEqual(
      delivered.steps.map((s) => s.at),
      [placedAt, paidAt, shippedAt, deliveredAt],
    );

    const shipped = getOrderTimeline("SHIPPED", "RAZORPAY", true, { placedAt, paidAt, shippedAt });
    assert.deepEqual(
      shipped.steps.map((s) => s.at),
      [placedAt, paidAt, shippedAt, undefined],
      "the current (not yet reached) delivered step must carry no date",
    );

    // Even if a caller hands over a later timestamp, an upcoming/current
    // step is never dated.
    const processing = getOrderTimeline("PROCESSING", "RAZORPAY", true, { placedAt, paidAt, shippedAt });
    assert.equal(processing.steps.find((s) => s.id === "shipped")?.at, undefined);
  });

  // F-199 fix: a cash-on-delivery order-request is paid at the door, so its
  // payment is recorded after it shipped (or was delivered) — the timeline
  // must still show the confirmation step, dated when it was recorded.
  it("F-199: an order-request paid after it shipped or was delivered shows (and dates) its confirmation step", () => {
    const placedAt = new Date("2026-09-20T05:00:00Z");
    const shippedAt = new Date("2026-09-21T10:00:00Z");
    const deliveredAt = new Date("2026-09-24T10:00:00Z");
    const paidAt = new Date("2026-09-24T10:05:00Z");

    const delivered = getOrderTimeline("DELIVERED", "ORDER_REQUEST", true, { placedAt, paidAt, shippedAt, deliveredAt });
    assert.deepEqual(
      delivered.steps.map((s) => [s.id, s.state, s.at]),
      [
        ["placed", "complete", placedAt],
        ["confirmed", "complete", paidAt],
        ["shipped", "complete", shippedAt],
        ["delivered", "complete", deliveredAt],
      ],
    );

    const shipped = getOrderTimeline("SHIPPED", "ORDER_REQUEST", true, { placedAt, paidAt, shippedAt });
    assert.equal(shipped.steps.find((s) => s.id === "confirmed")?.at, paidAt);
    assert.equal(shipped.steps.find((s) => s.id === "confirmed")?.label, "Order confirmed");
  });

  it("F-300: omitting the milestones leaves every step undated (existing callers read exactly as before)", () => {
    for (const status of orderStatusValues) {
      const timeline = getOrderTimeline(status, "RAZORPAY");
      assert.ok(timeline.steps.every((s) => s.at === undefined), `${status} should have no dated steps by default`);
    }
  });

  it("exhaustively covers the real prisma OrderStatus enum (fails loudly if the schema adds a new value)", () => {
    const covered = new Set<OrderStatus>([
      "PENDING_PAYMENT",
      "PAID",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "REFUNDED",
      "RETURNED",
    ]);
    for (const status of orderStatusValues) {
      assert.ok(covered.has(status), `${status} is in the schema but not in this test's coverage set`);
    }
    assert.equal(covered.size, orderStatusValues.length, "test coverage set and schema enum are out of sync");
  });
});

/**
 * F-120 fix: the heading at the top of the guest order page used to read
 * "Order confirmed" for every status.
 */
describe("getOrderStatusHero", () => {
  it("covers every OrderStatus for both payment methods", () => {
    for (const status of orderStatusValues) {
      for (const paymentMethod of ["RAZORPAY", "ORDER_REQUEST"] as const) {
        const hero = getOrderStatusHero(status, paymentMethod);
        assert.ok(hero.label.length > 0, `${status}/${paymentMethod} should have a heading`);
      }
    }
  });

  it("F-120: a cancelled order never reads 'Order confirmed' (either payment method)", () => {
    for (const paymentMethod of ["RAZORPAY", "ORDER_REQUEST"] as const) {
      const hero = getOrderStatusHero("CANCELLED", paymentMethod);
      assert.equal(hero.label, "Order cancelled");
      assert.equal(hero.icon, "cancelled");
    }
  });

  it("F-120: refunded and returned orders read as such, not as success", () => {
    assert.deepEqual(getOrderStatusHero("REFUNDED", "RAZORPAY"), { icon: "refunded", label: "Order refunded" });
    assert.deepEqual(getOrderStatusHero("RETURNED", "ORDER_REQUEST"), { icon: "refunded", label: "Order returned" });
  });

  it("F-120: an unpaid order never reads 'Order confirmed'", () => {
    assert.equal(getOrderStatusHero("PENDING_PAYMENT", "RAZORPAY").label, "Awaiting payment");
    assert.equal(getOrderStatusHero("PENDING_PAYMENT", "ORDER_REQUEST").label, "Order received");
    // create-order.ts starts ORDER_REQUEST orders in PROCESSING — still
    // nothing our team has confirmed until payment is recorded.
    assert.equal(getOrderStatusHero("PROCESSING", "ORDER_REQUEST").label, "Order received");
    assert.equal(getOrderStatusHero("PROCESSING", "ORDER_REQUEST", false).label, "Order received");
  });

  it("an order-request reads 'Order confirmed' once its payment has been recorded", () => {
    assert.equal(getOrderStatusHero("PROCESSING", "ORDER_REQUEST", true).label, "Order confirmed");
    assert.equal(getOrderStatusHero("PAID", "ORDER_REQUEST", true).label, "Order confirmed");
  });

  it("a RAZORPAY order in PROCESSING is confirmed (it can only get there through PAID)", () => {
    assert.equal(getOrderStatusHero("PROCESSING", "RAZORPAY").label, "Order confirmed");
  });

  it("shipped and delivered orders say so", () => {
    assert.deepEqual(getOrderStatusHero("SHIPPED", "RAZORPAY"), { icon: "truck", label: "Order shipped" });
    assert.equal(getOrderStatusHero("DELIVERED", "ORDER_REQUEST").label, "Order delivered");
  });
});
