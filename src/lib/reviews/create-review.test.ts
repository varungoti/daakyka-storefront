import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeVerifiedPurchase } from "@/lib/reviews/create-review";
import { reviewSubmissionGate } from "@/lib/reviews/eligibility";
import { reviewCreateSchema } from "@/lib/validation/schemas";

describe("computeVerifiedPurchase (Phase D2)", () => {
  it("is false for an empty order-item list", () => {
    assert.equal(computeVerifiedPurchase([]), false);
  });

  it("is true when an order item's order status is PAID", () => {
    assert.equal(computeVerifiedPurchase([{ order: { status: "PAID" } }]), true);
  });

  it("is true when an order item's order status is PROCESSING (the ORDER_REQUEST immediate-decrement status)", () => {
    assert.equal(computeVerifiedPurchase([{ order: { status: "PROCESSING" } }]), true);
  });

  it("is false when every order item's status is PENDING_PAYMENT", () => {
    assert.equal(computeVerifiedPurchase([{ order: { status: "PENDING_PAYMENT" } }]), false);
  });

  it("is false for CANCELLED or REFUNDED orders", () => {
    assert.equal(computeVerifiedPurchase([{ order: { status: "CANCELLED" } }]), false);
    assert.equal(computeVerifiedPurchase([{ order: { status: "REFUNDED" } }]), false);
  });

  it("is true if at least one of several order items counts, even if others don't", () => {
    assert.equal(
      computeVerifiedPurchase([
        { order: { status: "PENDING_PAYMENT" } },
        { order: { status: "CANCELLED" } },
        { order: { status: "PAID" } },
      ]),
      true,
    );
  });
});

describe("reviewSubmissionGate (Phase D2)", () => {
  it("returns 401 for no session", () => {
    const result = reviewSubmissionGate(null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  it("returns 403 for a session with no verified email", () => {
    const result = reviewSubmissionGate({ emailVerifiedAt: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("is ok for a verified session", () => {
    const result = reviewSubmissionGate({ emailVerifiedAt: new Date() });
    assert.equal(result.ok, true);
  });
});

describe("reviewCreateSchema bounds (Phase D2)", () => {
  const base = { productId: "prod_1", rating: 5, title: "A perfectly fine title", body: "A perfectly fine review body." };

  it("accepts a valid submission", () => {
    assert.equal(reviewCreateSchema.safeParse(base).success, true);
  });

  it("rejects a rating outside 1-5", () => {
    assert.equal(reviewCreateSchema.safeParse({ ...base, rating: 0 }).success, false);
    assert.equal(reviewCreateSchema.safeParse({ ...base, rating: 6 }).success, false);
  });

  it("rejects a non-integer rating", () => {
    assert.equal(reviewCreateSchema.safeParse({ ...base, rating: 4.5 }).success, false);
  });

  it("rejects a title shorter than 4 chars or longer than 120", () => {
    assert.equal(reviewCreateSchema.safeParse({ ...base, title: "Hi" }).success, false);
    assert.equal(reviewCreateSchema.safeParse({ ...base, title: "x".repeat(121) }).success, false);
    assert.equal(reviewCreateSchema.safeParse({ ...base, title: "x".repeat(120) }).success, true);
  });

  it("rejects a body shorter than 10 chars or longer than 2000", () => {
    assert.equal(reviewCreateSchema.safeParse({ ...base, body: "short" }).success, false);
    assert.equal(reviewCreateSchema.safeParse({ ...base, body: "x".repeat(2001) }).success, false);
    assert.equal(reviewCreateSchema.safeParse({ ...base, body: "x".repeat(2000) }).success, true);
  });

  it("rejects more than 3 photoAssetIds", () => {
    assert.equal(
      reviewCreateSchema.safeParse({ ...base, photoAssetIds: ["a", "b", "c", "d"] }).success,
      false,
    );
    assert.equal(
      reviewCreateSchema.safeParse({ ...base, photoAssetIds: ["a", "b", "c"] }).success,
      true,
    );
  });
});
