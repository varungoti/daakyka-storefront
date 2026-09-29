import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatReceiptDate, getReceiptPaymentSummary } from "@/lib/orders/receipt";
import { orderStatusValues } from "@/lib/orders/admin-orders";

/**
 * F-328 (print stylesheet + order receipt): covers the pure payment-status
 * wording and IST date formatting used by the printed/saved order receipt
 * on /order/[number]. Presentation itself isn't exercised here — same
 * split as timeline.test.ts covering getOrderTimeline.
 */
describe("getReceiptPaymentSummary", () => {
  it("covers every OrderStatus value without throwing, for both payment methods", () => {
    for (const status of orderStatusValues) {
      for (const paymentMethod of ["RAZORPAY", "ORDER_REQUEST"] as const) {
        for (const hasCapturedPayment of [true, false]) {
          const summary = getReceiptPaymentSummary(status, paymentMethod, hasCapturedPayment);
          assert.ok(summary.length > 0, `${status}/${paymentMethod}/${hasCapturedPayment} should render something`);
        }
      }
    }
  });

  it("never claims a RAZORPAY payment is 'paid' before it's actually PAID/PROCESSING/SHIPPED/DELIVERED", () => {
    assert.match(getReceiptPaymentSummary("PENDING_PAYMENT", "RAZORPAY", false), /awaiting payment/);
    assert.match(getReceiptPaymentSummary("PAID", "RAZORPAY", true), /paid/);
    assert.match(getReceiptPaymentSummary("PROCESSING", "RAZORPAY", true), /paid/);
  });

  it("an ORDER_REQUEST order reads as 'awaiting confirmation', not 'paid', through PENDING_PAYMENT and PROCESSING", () => {
    assert.match(getReceiptPaymentSummary("PENDING_PAYMENT", "ORDER_REQUEST", false), /awaiting confirmation/);
    assert.match(getReceiptPaymentSummary("PROCESSING", "ORDER_REQUEST", false), /awaiting confirmation/);
  });

  it("a manually paid ORDER_REQUEST remains paid when its status becomes PROCESSING", () => {
    assert.match(getReceiptPaymentSummary("PROCESSING", "ORDER_REQUEST", false, true), /paid/);
    assert.match(getReceiptPaymentSummary("SHIPPED", "ORDER_REQUEST", false, false), /payment not recorded/);
    assert.match(getReceiptPaymentSummary("DELIVERED", "ORDER_REQUEST", false, true), /paid/);
  });

  it("a CANCELLED RAZORPAY order that never captured a payment says 'not charged', not 'cancelled'", () => {
    assert.match(getReceiptPaymentSummary("CANCELLED", "RAZORPAY", false), /not charged/);
    assert.match(getReceiptPaymentSummary("CANCELLED", "RAZORPAY", true), /cancelled/);
    // No captured-payment signal exists for ORDER_REQUEST — always reads as a plain cancellation.
    assert.match(getReceiptPaymentSummary("CANCELLED", "ORDER_REQUEST", false), /cancelled/);
  });

  it("includes the human-readable method name", () => {
    assert.match(getReceiptPaymentSummary("PAID", "RAZORPAY", true), /^Razorpay/);
    assert.match(getReceiptPaymentSummary("PAID", "ORDER_REQUEST", true), /^Order Request \(manual invoice\)/);
  });
});

describe("formatReceiptDate", () => {
  it("formats in IST regardless of the environment's local timezone", () => {
    // 2026-01-01T20:00:00Z is 2026-01-02 01:30 IST (UTC+5:30) — a UTC date
    // that would print the *wrong day* if formatted without an explicit
    // timeZone.
    const formatted = formatReceiptDate(new Date("2026-01-01T20:00:00Z"));
    assert.equal(formatted, "2 Jan 2026");
  });

  it("formats a plain IST morning date as the same calendar day", () => {
    const formatted = formatReceiptDate(new Date("2026-03-15T04:00:00Z"));
    assert.equal(formatted, "15 Mar 2026");
  });
});
