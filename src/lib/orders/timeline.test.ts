import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrderTimeline } from "@/lib/orders/timeline";
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

  it("REFUNDED asserts placed+confirmed as fact (only reachable from PAID) and renders a terminal banner", () => {
    const timeline = getOrderTimeline("REFUNDED", "RAZORPAY");
    assert.equal(timeline.steps.length, 2);
    assert.deepEqual(
      timeline.steps.map((s) => s.state),
      ["complete", "complete"],
    );
    assert.ok(timeline.terminal);
    assert.equal(timeline.terminal!.tone, "refunded");
  });

  it("never claims a step happened that the transition matrix contradicts (CANCELLED vs REFUNDED asymmetry)", () => {
    // CANCELLED is reachable *before* payment (PENDING_PAYMENT -> CANCELLED
    // per ORDER_STATUS_TRANSITIONS), so it must not claim "confirmed"
    // happened. REFUNDED is only reachable from PAID, so it may.
    const cancelled = getOrderTimeline("CANCELLED", "RAZORPAY");
    const refunded = getOrderTimeline("REFUNDED", "RAZORPAY");
    assert.ok(!cancelled.steps.some((s) => s.id === "confirmed"));
    assert.ok(refunded.steps.some((s) => s.id === "confirmed"));
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
    ]);
    for (const status of orderStatusValues) {
      assert.ok(covered.has(status), `${status} is in the schema but not in this test's coverage set`);
    }
    assert.equal(covered.size, orderStatusValues.length, "test coverage set and schema enum are out of sync");
  });
});
