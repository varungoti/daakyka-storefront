import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getApprovedReviews, getReviewSummary } from "@/lib/reviews";
import { GET as getReviewsRoute } from "@/app/api/products/[handle]/reviews/route";

/**
 * Phase C5: getApprovedReviews/getReviewSummary and the public
 * GET /api/products/[handle]/reviews route, exercised against real rows
 * (one APPROVED, one PENDING) inserted for the duration of this test and
 * cleaned up in `after`. Confirms the PENDING review never counts toward
 * the summary or the returned list, and that a product with zero reviews
 * doesn't throw — it just returns an empty array.
 */
describe("reviews (Phase C5)", () => {
  let categoryId: string;
  let productId: string;
  let productSlug: string;
  let customerAId: string;
  let customerBId: string;
  let approvedReviewId: string;
  let pendingReviewId: string;
  let emptyProductId: string | undefined;

  before(async () => {
    const unique = randomUUID().slice(0, 8);

    const category = await db.category.create({
      data: {
        name: `Test Reviews Category ${unique}`,
        slug: `test-reviews-category-${unique}`,
        section: "GENERAL",
      },
    });
    categoryId = category.id;

    productSlug = `test-review-product-${unique}`;
    const product = await db.product.create({
      data: { name: `Test Review Product ${unique}`, slug: productSlug, categoryId, price: 500, status: "ACTIVE" },
    });
    productId = product.id;

    const customerA = await db.customer.create({
      data: { email: `reviewer-a-${unique}@example.com`, name: "Priya Sharma", passwordHash: "x" },
    });
    customerAId = customerA.id;

    const customerB = await db.customer.create({
      data: { email: `reviewer-b-${unique}@example.com`, name: "Arjun Rao", passwordHash: "x" },
    });
    customerBId = customerB.id;

    const approved = await db.review.create({
      data: {
        productId,
        customerId: customerAId,
        rating: 5,
        title: "Great fit",
        body: "Loved the fabric and the fit.",
        status: "APPROVED",
        verifiedPurchase: true,
      },
    });
    approvedReviewId = approved.id;

    const pending = await db.review.create({
      data: {
        productId,
        customerId: customerBId,
        rating: 1,
        title: "Not moderated yet",
        body: "This should never appear in the public summary or list.",
        status: "PENDING",
      },
    });
    pendingReviewId = pending.id;
  });

  after(async () => {
    await db.review.deleteMany({ where: { id: { in: [approvedReviewId, pendingReviewId] } } }).catch(() => {});
    await db.customer.deleteMany({ where: { id: { in: [customerAId, customerBId] } } }).catch(() => {});
    if (emptyProductId) {
      await db.product.delete({ where: { id: emptyProductId } }).catch(() => {});
    }
    await db.product.delete({ where: { id: productId } }).catch(() => {});
    await db.category.delete({ where: { id: categoryId } }).catch(() => {});
  });

  it("getReviewSummary counts only the APPROVED review", async () => {
    const summary = await getReviewSummary(productId);
    assert.equal(summary.count, 1);
    assert.equal(summary.average, 5);
    assert.equal(summary.histogram[5], 1);
    assert.equal(summary.histogram[1], 0);
  });

  it("getApprovedReviews returns only the APPROVED review, with an anonymized reviewer name", async () => {
    const result = await getApprovedReviews(productId, {});
    assert.equal(result.total, 1);
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].id, approvedReviewId);
    assert.equal(result.reviews[0].reviewerName, "Priya S.");
    assert.equal(result.reviews[0].verifiedPurchase, true);
    assert.equal(result.hasMore, false);
  });

  it("GET /api/products/[handle]/reviews returns 200 with just the approved review", async () => {
    const response = await getReviewsRoute(new Request(`http://localhost/api/products/${productSlug}/reviews`), {
      params: Promise.resolve({ handle: productSlug }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 1);
    assert.equal(data.reviews.length, 1);
    assert.equal(data.reviews[0].id, approvedReviewId);
  });

  it("GET /api/products/[handle]/reviews returns 200 with an empty array for a product with no reviews", async () => {
    const unique = randomUUID().slice(0, 8);
    const emptyProduct = await db.product.create({
      data: { name: `No Reviews Yet ${unique}`, slug: `no-reviews-yet-${unique}`, categoryId, price: 300, status: "ACTIVE" },
    });
    emptyProductId = emptyProduct.id;

    const response = await getReviewsRoute(
      new Request(`http://localhost/api/products/${emptyProduct.slug}/reviews`),
      { params: Promise.resolve({ handle: emptyProduct.slug }) },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.reviews, []);
    assert.equal(data.total, 0);
    assert.equal(data.hasMore, false);
  });
});
