import { revalidateTag } from "next/cache";
import type { ReviewStatus } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { PRODUCTS_CACHE_TAG, productCacheTag } from "@/lib/products";

/**
 * Phase D2: admin moderation of customer reviews (`reviews:moderate`).
 *
 * Every mutation here is an ADMIN action (a `User`, not a `Customer`, is
 * doing it) even though the review itself is customer-authored — so
 * `logAuditEvent` (the same admin-scoped audit helper every other admin
 * mutation in this codebase uses) applies unchanged; `moderatorUserId`
 * below is a `User.id`, matching `Review.moderatedById`'s FK target.
 */

export class ReviewNotFoundError extends Error {
  constructor() {
    super("Review not found");
    this.name = "ReviewNotFoundError";
  }
}

export interface ModeratedReview {
  id: string;
  status: ReviewStatus;
}

function revalidateProductReviews(slug: string): void {
  try {
    revalidateTag(PRODUCTS_CACHE_TAG, "max");
    revalidateTag(productCacheTag(slug), "max");
  } catch {
    // No static generation store in this context (unit/integration tests
    // calling moderate functions directly, one-off scripts) — nothing to
    // revalidate. Matches the try/catch pattern already used by
    // src/lib/settings/index.ts's setSetting().
  }
}

async function loadReviewWithProductSlug(reviewId: string) {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, product: { select: { slug: true } } },
  });
  if (!review) throw new ReviewNotFoundError();
  return review;
}

/** Approves a review: flips it to APPROVED, stamps the moderator/time, logs
 * the audit event, and revalidates the product's cache tags so the
 * storefront reviews list and rating summary reflect it. */
export async function approveReview(reviewId: string, moderatorUserId: string): Promise<ModeratedReview> {
  const existing = await loadReviewWithProductSlug(reviewId);

  const review = await db.review.update({
    where: { id: reviewId },
    data: { status: "APPROVED", moderatedById: moderatorUserId, moderatedAt: new Date() },
    select: { id: true, status: true },
  });

  await logAuditEvent({
    userId: moderatorUserId,
    action: "approve",
    entity: "review",
    entityId: reviewId,
    metadata: { previousStatus: existing.status },
  });

  revalidateProductReviews(existing.product.slug);

  return review;
}

/**
 * Rejects a review: flips it to REJECTED, stamps the moderator/time, and
 * logs the audit event (with the optional `reason` in the audit metadata).
 *
 * Design decision (documented per the phase brief): the `Review` model has
 * no column to persist a rejection reason, and adding one would mean a
 * migration for a single optional field this phase doesn't otherwise need.
 * The reason is kept in the audit log's metadata (queryable by an admin who
 * needs to know why a specific review was rejected) rather than on the
 * row itself; a rejected review is never shown to the customer or public
 * anyway, so there's no UI surface that needs to read it back off the
 * `Review` row. Flagged here as a deferred follow-up if product wants a
 * customer-facing rejection reason later.
 */
export async function rejectReview(
  reviewId: string,
  moderatorUserId: string,
  reason?: string,
): Promise<ModeratedReview> {
  const existing = await loadReviewWithProductSlug(reviewId);

  const review = await db.review.update({
    where: { id: reviewId },
    data: { status: "REJECTED", moderatedById: moderatorUserId, moderatedAt: new Date() },
    select: { id: true, status: true },
  });

  await logAuditEvent({
    userId: moderatorUserId,
    action: "reject",
    entity: "review",
    entityId: reviewId,
    metadata: { previousStatus: existing.status, reason: reason ?? null },
  });

  // A rejected review was never public (PENDING reviews aren't shown
  // either), so strictly nothing changes for a cached storefront read.
  // Revalidating anyway costs little and keeps this function's cache
  // behavior symmetric with approveReview/bulkApprove rather than being a
  // surprising exception a future reader has to reason about.
  revalidateProductReviews(existing.product.slug);

  return review;
}

export interface BulkApproveResult {
  approvedIds: string[];
  notFoundIds: string[];
}

/** Approves every review id in `reviewIds`, skipping (and reporting) any
 * that don't exist rather than failing the whole batch. */
export async function bulkApprove(
  reviewIds: string[],
  moderatorUserId: string,
): Promise<BulkApproveResult> {
  const approvedIds: string[] = [];
  const notFoundIds: string[] = [];

  for (const reviewId of reviewIds) {
    try {
      const result = await approveReview(reviewId, moderatorUserId);
      approvedIds.push(result.id);
    } catch (error) {
      if (error instanceof ReviewNotFoundError) {
        notFoundIds.push(reviewId);
        continue;
      }
      throw error;
    }
  }

  return { approvedIds, notFoundIds };
}

export interface ListReviewsForAdminOptions {
  status?: ReviewStatus;
  productId?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: string;
  moderatedAt: string | null;
  photos: { url: string; alt: string | null }[];
  customer: { id: string; name: string; email: string };
  product: { id: string; name: string; slug: string; image: string | null };
}

export interface ListReviewsForAdminResult {
  reviews: AdminReviewRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const DEFAULT_ADMIN_PAGE_SIZE = 20;

/** Backs the /admin/reviews moderation queue: every status by default is
 * narrowed by the `status` filter, optionally scoped to one product. */
export async function listReviewsForAdmin(
  options: ListReviewsForAdminOptions = {},
): Promise<ListReviewsForAdminResult> {
  const page = options.page && options.page > 0 ? Math.floor(options.page) : 1;
  const pageSize =
    options.pageSize && options.pageSize > 0 ? Math.floor(options.pageSize) : DEFAULT_ADMIN_PAGE_SIZE;

  const where = {
    ...(options.status ? { status: options.status } : {}),
    ...(options.productId ? { productId: options.productId } : {}),
  };

  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, email: true } },
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: { orderBy: { sortOrder: "asc" }, take: 1, include: { media: true } },
          },
        },
      },
    }),
    db.review.count({ where }),
  ]);

  const allPhotoIds = [...new Set(rows.flatMap((row) => row.photoIds))];
  const photoAssets =
    allPhotoIds.length > 0
      ? await db.mediaAsset.findMany({
          where: { id: { in: allPhotoIds } },
          select: { id: true, url: true, alt: true },
        })
      : [];
  const photoMap = new Map(photoAssets.map((asset) => [asset.id, asset]));

  const reviews: AdminReviewRow[] = rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status,
    verifiedPurchase: row.verifiedPurchase,
    createdAt: row.createdAt.toISOString(),
    moderatedAt: row.moderatedAt ? row.moderatedAt.toISOString() : null,
    photos: row.photoIds
      .map((id) => photoMap.get(id))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => ({ url: asset.url, alt: asset.alt })),
    customer: row.customer,
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
      image: row.product.images[0]?.media.url ?? null,
    },
  }));

  return { reviews, total, page, pageSize, hasMore: page * pageSize < total };
}
