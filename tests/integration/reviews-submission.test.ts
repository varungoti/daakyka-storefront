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
  bulkReject,
  listReviewsForAdmin,
  rejectReview,
  ReviewConcurrentModificationError,
  ReviewNotFoundError,
} from "@/lib/reviews/moderate-review";
import { getApprovedReviews, getReviewSummary } from "@/lib/reviews";
import { GET as getAdminReviews } from "@/app/api/admin/reviews/route";
import { PATCH as patchAdminReview } from "@/app/api/admin/reviews/[id]/route";
import { POST as postAdminReviewsBulk } from "@/app/api/admin/reviews/bulk/route";
import { POST as postReviews } from "@/app/api/reviews/route";
import { findAnyAdminId } from "../helpers/admin-user";

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

  // F-362: a rejected review's photos used to stay in Postgres/R2,
  // publicly downloadable forever, since nothing ever removed them.
  // rejectReview now reclaims them through deleteUnattachedMediaAsset
  // (src/lib/media/store.ts) — its own guard (isReferencedByNonRejectedReview,
  // F-357) is what makes this safe to call unconditionally: it only ever
  // deletes a photo whose *only* review reference is now REJECTED.
  it("rejectReview deletes the review's own (now-unreferenced) photos", async () => {
    const unique = randomUUID().slice(0, 8);
    const customer = await db.customer.create({
      data: { email: `d2-reject-photo-${unique}@example.com`, name: "Reject Photo Customer", passwordHash: "x" },
    });
    const reviewAsset = await db.mediaAsset.create({
      data: {
        key: `test/reject-photo-${unique}.webp`,
        url: "https://example.test/reject-photo.webp",
        usage: "REVIEW",
        source: "UPLOAD",
      },
    });

    let reviewId: string | undefined;
    try {
      const review = await createReview({
        customerId: customer.id,
        productId,
        rating: 2,
        title: "Review with a photo that gets rejected",
        body: "This review attaches a photo and then gets rejected by moderation.",
        photoAssetIds: [reviewAsset.id],
      });
      reviewId = review.id;

      const stillThere = await db.mediaAsset.findUnique({ where: { id: reviewAsset.id } });
      assert.ok(stillThere, "photo should exist before rejection");

      await rejectReview(reviewId, adminId, "Not relevant");

      const afterReject = await db.mediaAsset.findUnique({ where: { id: reviewAsset.id } });
      assert.equal(afterReject, null, "photo should be deleted once its review is rejected");
    } finally {
      if (reviewId) await db.review.delete({ where: { id: reviewId } }).catch(() => {});
      await db.mediaAsset.delete({ where: { id: reviewAsset.id } }).catch(() => {});
      await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
    }
  });

  // F-362: rejecting a review whose photo is (unusually) also still
  // referenced elsewhere — a hero slide is the simplest case to construct
  // here — must not fail the moderation action itself; the photo is left
  // for scripts/cleanup-orphaned-media.ts, same as any other MediaAssetInUseError.
  it("rejectReview still succeeds even if one of its photos can't be deleted", async () => {
    const unique = randomUUID().slice(0, 8);
    const customer = await db.customer.create({
      data: { email: `d2-reject-inuse-photo-${unique}@example.com`, name: "Reject In-Use Photo Customer", passwordHash: "x" },
    });
    const reviewAsset = await db.mediaAsset.create({
      data: {
        key: `test/reject-inuse-photo-${unique}.webp`,
        url: "https://example.test/reject-inuse-photo.webp",
        usage: "REVIEW",
        source: "UPLOAD",
      },
    });
    // A category's `imageId` is a real MediaAsset relation (unlike the
    // hero-slide snapshot) — the simplest way to make
    // deleteUnattachedMediaAsset's MediaAssetInUseError guard trip.
    await db.category.update({ where: { id: categoryId }, data: { imageId: reviewAsset.id } });

    let reviewId: string | undefined;
    try {
      const review = await createReview({
        customerId: customer.id,
        productId,
        rating: 3,
        title: "Review whose photo is also a category image",
        body: "This review's photo is deliberately also referenced elsewhere.",
        photoAssetIds: [reviewAsset.id],
      });
      reviewId = review.id;

      const result = await rejectReview(reviewId, adminId, "Not relevant");
      assert.equal(result.status, "REJECTED");

      const stillThere = await db.mediaAsset.findUnique({ where: { id: reviewAsset.id } });
      assert.ok(stillThere, "an in-use photo must not be deleted, and must not block the reject");
    } finally {
      if (reviewId) await db.review.delete({ where: { id: reviewId } }).catch(() => {});
      await db.category.update({ where: { id: categoryId }, data: { imageId: null } }).catch(() => {});
      await db.mediaAsset.delete({ where: { id: reviewAsset.id } }).catch(() => {});
      await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
    }
  });

  // F-296: a REJECTED review no longer permanently locks the customer out
  // of the product with no way to fix it — resubmitting replaces the same
  // row (same id, reset to PENDING) rather than throwing AlreadyReviewedError,
  // and it drops the stale moderatedById/moderatedAt from the rejection so
  // the resubmission goes through moderation fresh. Uses its own
  // customer+product (rather than createdReviewIds[1]) so it doesn't
  // disturb that review's REJECTED status, which a later test in this file
  // (listReviewsForAdmin) still asserts on.
  it("resubmitting after a rejection updates the same row instead of throwing AlreadyReviewedError", async () => {
    const unique = randomUUID().slice(0, 8);
    const resubmitProduct = await db.product.create({
      data: { name: `D2 Resubmit ${unique}`, slug: `d2-resubmit-${unique}`, categoryId, price: 599, status: "ACTIVE" },
    });
    const resubmitCustomer = await db.customer.create({
      data: { email: `d2-resubmit-${unique}@example.com`, name: "Resubmit Customer", passwordHash: "x" },
    });

    try {
      const first = await createReview({
        customerId: resubmitCustomer.id,
        productId: resubmitProduct.id,
        rating: 1,
        title: "Off-topic first attempt",
        body: "This first review gets rejected by moderation in this test.",
      });
      await rejectReview(first.id, adminId, "Off-topic");
      const rejected = await db.review.findUnique({ where: { id: first.id } });
      assert.equal(rejected?.status, "REJECTED");

      const result = await createReview({
        customerId: resubmitCustomer.id,
        productId: resubmitProduct.id,
        rating: 5,
        title: "Revised after feedback",
        body: "Rewrote this review to follow the guidelines the first one missed.",
      });

      assert.equal(result.id, first.id, "resubmission should reuse the same review row");
      assert.equal(result.status, "PENDING");

      const after = await db.review.findUnique({ where: { id: first.id } });
      assert.equal(after?.status, "PENDING");
      assert.equal(after?.title, "Revised after feedback");
      assert.equal(after?.moderatedById, null);
      assert.equal(after?.moderatedAt, null);

      // A PENDING review (post-resubmit) still blocks a second submission
      // — only REJECTED is special-cased.
      await assert.rejects(
        () =>
          createReview({
            customerId: resubmitCustomer.id,
            productId: resubmitProduct.id,
            rating: 3,
            title: "Trying a third time",
            body: "This should be blocked because the resubmission is only PENDING, not REJECTED.",
          }),
        AlreadyReviewedError,
      );
    } finally {
      await db.review.deleteMany({ where: { productId: resubmitProduct.id } }).catch(() => {});
      await db.customer.delete({ where: { id: resubmitCustomer.id } }).catch(() => {});
      await db.product.delete({ where: { id: resubmitProduct.id } }).catch(() => {});
    }
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

  it("bulkReject rejects every valid id and reports unknown ids separately", async () => {
    const unique = randomUUID().slice(0, 8);
    const [customerA, customerB] = await Promise.all([
      db.customer.create({ data: { email: `d2-bulk-reject-a-${unique}@example.com`, name: "Bulk Reject A", passwordHash: "x" } }),
      db.customer.create({ data: { email: `d2-bulk-reject-b-${unique}@example.com`, name: "Bulk Reject B", passwordHash: "x" } }),
    ]);
    const [reviewA, reviewB] = await Promise.all([
      createReview({ customerId: customerA.id, productId, rating: 2, title: "Bulk reject candidate A", body: "This review should be rejected as part of a bulk operation." }),
      createReview({ customerId: customerB.id, productId, rating: 1, title: "Bulk reject candidate B", body: "This review should also be rejected as part of the same bulk call." }),
    ]);
    createdReviewIds.push(reviewA.id, reviewB.id);

    try {
      const result = await bulkReject([reviewA.id, reviewB.id, "does-not-exist"], adminId, "Bulk cleanup");
      assert.deepEqual([...result.rejectedIds].sort(), [reviewA.id, reviewB.id].sort());
      assert.deepEqual(result.notFoundIds, ["does-not-exist"]);

      const rows = await db.review.findMany({ where: { id: { in: [reviewA.id, reviewB.id] } } });
      assert.ok(rows.every((r) => r.status === "REJECTED"));
    } finally {
      await db.customer.deleteMany({ where: { id: { in: [customerA.id, customerB.id] } } }).catch(() => {});
    }
  });

  // F-030: photoAssetIds used to be stored verbatim with no check that they
  // exist, were uploaded for review use, or aren't already someone else's
  // review photo.
  describe("createReview validates photoAssetIds (F-030)", () => {
    it("rejects a photoAssetId that isn't usage=REVIEW (e.g. a product photo)", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `d2-photo-usage-${unique}@example.com`, name: "Photo Usage Customer", passwordHash: "x" },
      });
      const nonReviewAsset = await db.mediaAsset.create({
        data: {
          key: `test/non-review-${unique}.webp`,
          url: "https://example.test/non-review.webp",
          usage: "PRODUCT",
          source: "UPLOAD",
        },
      });
      try {
        await assert.rejects(
          () =>
            createReview({
              customerId: customer.id,
              productId,
              rating: 5,
              title: "Photo usage guard test",
              body: "This review tries to attach a product photo, not a review photo.",
              photoAssetIds: [nonReviewAsset.id],
            }),
          InvalidReviewInputError,
        );
      } finally {
        await db.mediaAsset.delete({ where: { id: nonReviewAsset.id } }).catch(() => {});
        await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
      }
    });

    it("rejects a photoAssetId already attached to a different, non-rejected review", async () => {
      const unique = randomUUID().slice(0, 8);
      const [ownerCustomer, attackerCustomer] = await Promise.all([
        db.customer.create({ data: { email: `d2-photo-owner-${unique}@example.com`, name: "Photo Owner", passwordHash: "x" } }),
        db.customer.create({ data: { email: `d2-photo-attacker-${unique}@example.com`, name: "Photo Attacker", passwordHash: "x" } }),
      ]);
      const reviewAsset = await db.mediaAsset.create({
        data: {
          key: `test/review-photo-${unique}.webp`,
          url: "https://example.test/review.webp",
          usage: "REVIEW",
          source: "UPLOAD",
        },
      });
      let ownerReviewId: string | undefined;
      try {
        const ownerReview = await createReview({
          customerId: ownerCustomer.id,
          productId,
          rating: 5,
          title: "Owner's review with a photo",
          body: "This review legitimately attaches the review photo it uploaded.",
          photoAssetIds: [reviewAsset.id],
        });
        ownerReviewId = ownerReview.id;

        await assert.rejects(
          () =>
            createReview({
              customerId: attackerCustomer.id,
              productId,
              rating: 1,
              title: "Trying to reuse someone else's photo",
              body: "This review tries to attach a photo id from the review created above.",
              photoAssetIds: [reviewAsset.id],
            }),
          InvalidReviewInputError,
        );
      } finally {
        if (ownerReviewId) await db.review.delete({ where: { id: ownerReviewId } }).catch(() => {});
        await db.mediaAsset.delete({ where: { id: reviewAsset.id } }).catch(() => {});
        await db.customer
          .deleteMany({ where: { id: { in: [ownerCustomer.id, attackerCustomer.id] } } })
          .catch(() => {});
      }
    });
  });

  // F-343: approveReview/rejectReview used to write unconditionally — two
  // admins moderating the same review at once both got a 200, with
  // whichever write committed last silently winning.
  describe("optimistic concurrency guard on review moderation (F-343)", () => {
    it("two concurrent moderate calls on the same PENDING review: exactly one succeeds, the other gets ReviewConcurrentModificationError", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `d2-race-${unique}@example.com`, name: "Race Customer", passwordHash: "x" },
      });
      const review = await createReview({
        customerId: customer.id,
        productId,
        rating: 3,
        title: "Race condition candidate",
        body: "This review is used to test the optimistic concurrency guard.",
      });
      try {
        const [approveOutcome, rejectOutcome] = await Promise.allSettled([
          approveReview(review.id, adminId, { fromStatus: "PENDING" }),
          rejectReview(review.id, adminId, "Racing reject", { fromStatus: "PENDING" }),
        ]);
        const outcomes = [approveOutcome, rejectOutcome];

        assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, "exactly one call should succeed");
        const failed = outcomes.filter((o) => o.status === "rejected");
        assert.equal(failed.length, 1, "exactly one call should fail");
        assert.ok(failed[0].status === "rejected" && failed[0].reason instanceof ReviewConcurrentModificationError);

        // Whichever one won, the row now reflects a single, unambiguous
        // status — not silently overwritten by the loser.
        const final = await db.review.findUnique({ where: { id: review.id } });
        assert.ok(final?.status === "APPROVED" || final?.status === "REJECTED");
      } finally {
        await db.review.delete({ where: { id: review.id } }).catch(() => {});
        await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
      }
    });

    it("rejects with ReviewConcurrentModificationError when fromStatus no longer matches the row", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `d2-stale-${unique}@example.com`, name: "Stale Customer", passwordHash: "x" },
      });
      const review = await createReview({
        customerId: customer.id,
        productId,
        rating: 4,
        title: "Stale fromStatus candidate",
        body: "This review is still PENDING, but the caller believes it's REJECTED.",
      });
      try {
        await assert.rejects(
          () => approveReview(review.id, adminId, { fromStatus: "REJECTED" }),
          ReviewConcurrentModificationError,
        );
        const row = await db.review.findUnique({ where: { id: review.id } });
        assert.equal(row?.status, "PENDING", "a stale/failed guard must not have changed the row");
      } finally {
        await db.review.delete({ where: { id: review.id } }).catch(() => {});
        await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
      }
    });

    // F-203: unpublish (reject an APPROVED review) and restore (approve a
    // REJECTED one) both go through the same guarded write, keyed on
    // whichever status the admin UI last observed the row in.
    it("rejectReview with fromStatus=APPROVED unpublishes an already-approved review", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `d2-unpublish-${unique}@example.com`, name: "Unpublish Customer", passwordHash: "x" },
      });
      const review = await createReview({
        customerId: customer.id,
        productId,
        rating: 5,
        title: "Unpublish candidate",
        body: "This review gets approved and then unpublished in this test.",
      });
      try {
        await approveReview(review.id, adminId, { fromStatus: "PENDING" });
        const result = await rejectReview(review.id, adminId, "Reported as fake", { fromStatus: "APPROVED" });
        assert.equal(result.status, "REJECTED");

        const approvedList = await getApprovedReviews(productId, {});
        assert.ok(!approvedList.reviews.some((r) => r.id === review.id));
      } finally {
        await db.review.delete({ where: { id: review.id } }).catch(() => {});
        await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
      }
    });

    it("approveReview with fromStatus=REJECTED restores a rejected review", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `d2-restore-${unique}@example.com`, name: "Restore Customer", passwordHash: "x" },
      });
      const review = await createReview({
        customerId: customer.id,
        productId,
        rating: 2,
        title: "Restore candidate",
        body: "This review gets rejected and then restored in this test.",
      });
      try {
        await rejectReview(review.id, adminId, "Initial reject", { fromStatus: "PENDING" });
        const result = await approveReview(review.id, adminId, { fromStatus: "REJECTED" });
        assert.equal(result.status, "APPROVED");

        const approvedList = await getApprovedReviews(productId, {});
        assert.ok(approvedList.reviews.some((r) => r.id === review.id));
      } finally {
        await db.review.delete({ where: { id: review.id } }).catch(() => {});
        await db.customer.delete({ where: { id: customer.id } }).catch(() => {});
      }
    });
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
    await resetRateLimits(["reviews-create", "reviews-photo-upload"]);
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
