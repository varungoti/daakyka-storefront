import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/security/rate-limit";
import {
  AlreadyReviewedError,
  createReview,
  InvalidReviewInputError,
  ProductNotActiveError,
  ProductNotFoundError,
} from "@/lib/reviews/create-review";
import {
  approveReview,
  bulkApprove,
  listReviewsForAdmin,
  rejectReview,
  ReviewNotFoundError,
} from "@/lib/reviews/moderate-review";
import { getApprovedReviews, getReviewSummary } from "@/lib/reviews";
import { GET as getAdminReviews } from "@/app/api/admin/reviews/route";
import { PATCH as patchAdminReview } from "@/app/api/admin/reviews/[id]/route";
import { POST as postAdminReviewsBulk } from "@/app/api/admin/reviews/bulk/route";
import { POST as postReviews } from "@/app/api/reviews/route";

/**
 * Phase D2: review submission (lib/reviews/create-review.ts) and
 * moderation (lib/reviews/moderate-review.ts), exercised against real
 * rows, plus a 401/403 guard check on every new route.
 *
 * Same harness limitation as tests/integration/customer-auth.test.ts and
 * tests/integration/catalog-admin.test.ts: a route handler called directly
 * (not through a real Next.js request) can't carry a real session cookie —
 * `cookies()` throws, so `getCustomerSession()`/`getSession()` always
 * resolve null and every gated route can only ever be observed hitting its
 * 401 branch here. The *business logic* those routes call (createReview,
 * approveReview, rejectReview, bulkApprove, listReviewsForAdmin) is
 * exercised directly instead, which is where the real behavior lives. The
 * full cookie-based 403-unverified-email and 201-created flows are
 * exercised against a live `npm run start` server in the D2 runtime
 * verification step.
 */

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("review submission + moderation (Phase D2)", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let unpurchasedCustomerId: string;
  let purchasedCustomerId: string;
  let extraCustomerAId: string;
  let extraCustomerBId: string;
  let adminId: string;
  let orderId: string;

  const createdReviewIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();

    const unique = randomUUID().slice(0, 8);

    const category = await db.category.create({
      data: { name: `D2 Reviews Category ${unique}`, slug: `d2-reviews-category-${unique}`, section: "GENERAL" },
    });
    categoryId = category.id;

    const product = await db.product.create({
      data: {
        name: `D2 Review Product ${unique}`,
        slug: `d2-review-product-${unique}`,
        categoryId,
        price: 799,
        status: "ACTIVE",
        variants: {
          create: [{ sku: `D2-SKU-${unique}`, size: "M", color: "Blue", stock: 10 }],
        },
      },
      include: { variants: true },
    });
    productId = product.id;
    variantId = product.variants[0].id;

    const [a, b, c, d] = await Promise.all([
      db.customer.create({
        data: { email: `d2-noorder-${unique}@example.com`, name: "No Order Customer", passwordHash: "x" },
      }),
      db.customer.create({
        data: { email: `d2-paid-${unique}@example.com`, name: "Paid Customer", passwordHash: "x" },
      }),
      db.customer.create({
        data: { email: `d2-extra-a-${unique}@example.com`, name: "Extra A", passwordHash: "x" },
      }),
      db.customer.create({
        data: { email: `d2-extra-b-${unique}@example.com`, name: "Extra B", passwordHash: "x" },
      }),
    ]);
    unpurchasedCustomerId = a.id;
    purchasedCustomerId = b.id;
    extraCustomerAId = c.id;
    extraCustomerBId = d.id;

    const order = await db.order.create({
      data: {
        number: `D2TEST${unique}`,
        customerId: purchasedCustomerId,
        email: b.email,
        shippingAddress: { line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
        subtotal: 799,
        shipping: 0,
        total: 799,
        status: "PAID",
        paymentMethod: "RAZORPAY",
        items: {
          create: [
            {
              variantId,
              productName: product.name,
              unitPrice: 799,
              quantity: 1,
            },
          ],
        },
      },
    });
    orderId = order.id;
  });

  after(async () => {
    await db.review.deleteMany({ where: { id: { in: createdReviewIds } } }).catch(() => {});
    await db.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
    await db.order.delete({ where: { id: orderId } }).catch(() => {});
    await db.customer
      .deleteMany({
        where: { id: { in: [unpurchasedCustomerId, purchasedCustomerId, extraCustomerAId, extraCustomerBId] } },
      })
      .catch(() => {});
    await db.productVariant.deleteMany({ where: { productId } }).catch(() => {});
    await db.product.delete({ where: { id: productId } }).catch(() => {});
    await db.category.delete({ where: { id: categoryId } }).catch(() => {});
  });

  it("createReview happy path: PENDING status, verifiedPurchase=false without a matching paid order", async () => {
    const result = await createReview({
      customerId: unpurchasedCustomerId,
      productId,
      rating: 5,
      title: "Great everyday scrubs",
      body: "Comfortable fit and the fabric held up well after several washes.",
    });
    createdReviewIds.push(result.id);
    assert.equal(result.status, "PENDING");
    assert.equal(result.verifiedPurchase, false);

    const row = await db.review.findUnique({ where: { id: result.id } });
    assert.equal(row?.status, "PENDING");
    assert.equal(row?.verifiedPurchase, false);
  });

  it("createReview computes verifiedPurchase=true for a customer with a PAID order containing the product", async () => {
    const result = await createReview({
      customerId: purchasedCustomerId,
      productId,
      rating: 4,
      title: "Fit true to size",
      body: "Ordered a medium and it fit exactly as expected, would buy again.",
    });
    createdReviewIds.push(result.id);
    assert.equal(result.verifiedPurchase, true);
  });

  it("rejects a duplicate review from the same customer+product", async () => {
    await assert.rejects(
      () =>
        createReview({
          customerId: unpurchasedCustomerId,
          productId,
          rating: 3,
          title: "Trying again",
          body: "Submitting a second review for the same product should fail.",
        }),
      AlreadyReviewedError,
    );
  });

  it("rejects an out-of-bounds rating and too-short title/body", async () => {
    await assert.rejects(
      () =>
        createReview({
          customerId: extraCustomerAId,
          productId,
          rating: 6,
          title: "Valid length title",
          body: "This body text is definitely long enough to pass the bound.",
        }),
      InvalidReviewInputError,
    );
    await assert.rejects(
      () =>
        createReview({
          customerId: extraCustomerAId,
          productId,
          rating: 5,
          title: "Hi",
          body: "This body text is definitely long enough to pass the bound.",
        }),
      InvalidReviewInputError,
    );
    await assert.rejects(
      () =>
        createReview({
          customerId: extraCustomerAId,
          productId,
          rating: 5,
          title: "Valid length title",
          body: "Too short",
        }),
      InvalidReviewInputError,
    );
  });

  it("rejects a review for a product that doesn't exist", async () => {
    await assert.rejects(
      () =>
        createReview({
          customerId: extraCustomerAId,
          productId: "does-not-exist",
          rating: 5,
          title: "Valid length title",
          body: "This body text is definitely long enough to pass the bound.",
        }),
      ProductNotFoundError,
    );
  });

  it("rejects a review for a non-ACTIVE product", async () => {
    const unique = randomUUID().slice(0, 8);
    const draftProduct = await db.product.create({
      data: { name: `Draft ${unique}`, slug: `d2-draft-${unique}`, categoryId, price: 500, status: "DRAFT" },
    });
    try {
      await assert.rejects(
        () =>
          createReview({
            customerId: extraCustomerAId,
            productId: draftProduct.id,
            rating: 5,
            title: "Valid length title",
            body: "This body text is definitely long enough to pass the bound.",
          }),
        ProductNotActiveError,
      );
    } finally {
      await db.product.delete({ where: { id: draftProduct.id } }).catch(() => {});
    }
  });

  it("approveReview flips status, makes the review appear in getApprovedReviews, and updates getReviewSummary", async () => {
    const before = await getReviewSummary(productId);

    const targetId = createdReviewIds[0];
    const result = await approveReview(targetId, adminId);
    assert.equal(result.status, "APPROVED");

    const approvedList = await getApprovedReviews(productId, {});
    assert.ok(approvedList.reviews.some((r) => r.id === targetId));

    const after = await getReviewSummary(productId);
    assert.equal(after.count, before.count + 1);
  });

  it("rejectReview flips status and the review never appears in public reads", async () => {
    const targetId = createdReviewIds[1];
    const result = await rejectReview(targetId, adminId, "Not relevant to the product");
    assert.equal(result.status, "REJECTED");

    const approvedList = await getApprovedReviews(productId, {});
    assert.ok(!approvedList.reviews.some((r) => r.id === targetId));

    const audit = await db.auditLog.findFirst({
      where: { entity: "review", entityId: targetId, action: "reject" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit, "expected a reject audit log entry");
  });

  it("approveReview throws ReviewNotFoundError for an unknown id", async () => {
    await assert.rejects(() => approveReview("does-not-exist", adminId), ReviewNotFoundError);
  });

  it("bulkApprove approves every valid id and reports unknown ids separately", async () => {
    const [reviewA, reviewB] = await Promise.all([
      createReview({
        customerId: extraCustomerAId,
        productId,
        rating: 5,
        title: "Bulk approve candidate A",
        body: "This review should be approved as part of a bulk operation.",
      }),
      createReview({
        customerId: extraCustomerBId,
        productId,
        rating: 4,
        title: "Bulk approve candidate B",
        body: "This review should also be approved as part of the same bulk call.",
      }),
    ]);
    createdReviewIds.push(reviewA.id, reviewB.id);

    const result = await bulkApprove([reviewA.id, reviewB.id, "does-not-exist"], adminId);
    assert.deepEqual([...result.approvedIds].sort(), [reviewA.id, reviewB.id].sort());
    assert.deepEqual(result.notFoundIds, ["does-not-exist"]);

    const rows = await db.review.findMany({ where: { id: { in: [reviewA.id, reviewB.id] } } });
    assert.ok(rows.every((r) => r.status === "APPROVED"));
  });

  it("listReviewsForAdmin filters by status and product", async () => {
    const approved = await listReviewsForAdmin({ status: "APPROVED", productId });
    assert.ok(approved.reviews.length > 0);
    assert.ok(approved.reviews.every((r) => r.status === "APPROVED" && r.product.id === productId));

    const rejected = await listReviewsForAdmin({ status: "REJECTED", productId });
    assert.ok(rejected.reviews.some((r) => r.id === createdReviewIds[1]));
  });

  describe("admin review routes are guarded", () => {
    it("GET /api/admin/reviews rejects with 401/403", async () => {
      const response = await getAdminReviews(new Request("http://localhost/api/admin/reviews"));
      assert.ok(response.status === 401 || response.status === 403);
    });

    it("PATCH /api/admin/reviews/[id] rejects with 401/403", async () => {
      const response = await patchAdminReview(
        jsonRequest("http://localhost/api/admin/reviews/x", "PATCH", { action: "approve" }),
        { params: Promise.resolve({ id: "x" }) },
      );
      assert.ok(response.status === 401 || response.status === 403);
    });

    it("POST /api/admin/reviews/bulk rejects with 401/403", async () => {
      const response = await postAdminReviewsBulk(
        jsonRequest("http://localhost/api/admin/reviews/bulk", "POST", { action: "approve", ids: ["x"] }),
      );
      assert.ok(response.status === 401 || response.status === 403);
    });
  });

  it("POST /api/reviews rejects an unauthenticated request with 401", async () => {
    await resetRateLimits();
    const response = await postReviews(
      jsonRequest("http://localhost/api/reviews", "POST", {
        productId,
        rating: 5,
        title: "Valid length title",
        body: "This body text is definitely long enough to pass the bound.",
      }),
    );
    assert.equal(response.status, 401);
  });
});
