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

/**
 * F-343 fix: approveReview/rejectReview used to `db.review.update` the row
 * unconditionally — two admins acting on the same review at once (one
 * Approve, one Reject; or the same action twice) both got a 200, and
 * whichever write committed last silently won with no signal to the loser.
 * A caller that knows what status it last saw the review in passes it as
 * `fromStatus`; the write is then conditioned on the row still being in
 * that status (`updateMany({ where: { id, status: fromStatus } })`), and
 * this is thrown when nothing matched — the row exists (checked separately,
 * see loadReviewWithProductSlug) but someone else already moderated it out
 * from under this request. `fromStatus` is optional (older/direct callers —
 * scripts, tests exercising the business logic in isolation — keep the
 * previous unconditional-write behavior) but `PATCH /api/admin/reviews/[id]`,
 * the only real production caller, always supplies it.
 */
export class ReviewConcurrentModificationError extends Error {
  constructor() {
    super("This review was already moderated by someone else — reload and try again.");
    this.name = "ReviewConcurrentModificationError";
  }
}

export interface ModeratedReview {
  id: string;
  status: ReviewStatus;
}

export interface ModerationOptions {
  /** The status this caller last observed the review in — see
   * ReviewConcurrentModificationError above. Omit to write unconditionally. */
  fromStatus?: ReviewStatus;
}

function revalidateProductReviews(slug: string): void {
  try {
    // F-298: "max" serves one more stale response while it revalidates in
    // the background (see node_modules/next/dist/docs/.../revalidateTag.md,
    // "Revalidation Behavior") — for most cache tags that's the right
    // trade-off, but this specific tag gates the PDP header's rating/
    // review-count text (product.rating/reviewCount, read from the very
    // page this tag covers), which sits right next to the *uncached*
    // reviewSummary the Reviews section below it renders from. Serving one
    // more stale response here means those two numbers visibly disagree on
    // the first reload after an approve/reject ("No reviews yet" above,
    // "Based on 1 review" below). `{ expire: 0 }` makes the next request a
    // blocking revalidate instead, so both numbers are consistent from the
    // very first reload — an acceptable trade (one slower request,
    // immediately after an admin moderates) for a customer-visible
    // self-contradiction otherwise.
    revalidateTag(PRODUCTS_CACHE_TAG, { expire: 0 });
    revalidateTag(productCacheTag(slug), { expire: 0 });
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

/**
 * The actual status-flipping write, shared by approveReview/rejectReview.
 * Unconditional (`update`) when the caller has no `fromStatus` to guard
 * against; conditioned on the row still being in `fromStatus`
 * (`updateMany` — Prisma's `update` can only key off unique fields, and
 * `status` isn't one) otherwise, throwing ReviewConcurrentModificationError
 * when nothing matched.
 */
async function writeReviewStatus(
  reviewId: string,
  targetStatus: "APPROVED" | "REJECTED",
  moderatorUserId: string,
  fromStatus: ReviewStatus | undefined,
): Promise<ModeratedReview> {
  const data = { status: targetStatus, moderatedById: moderatorUserId, moderatedAt: new Date() };

  if (fromStatus === undefined) {
    return db.review.update({ where: { id: reviewId }, data, select: { id: true, status: true } });
  }

  const { count } = await db.review.updateMany({ where: { id: reviewId, status: fromStatus }, data });
  if (count === 0) throw new ReviewConcurrentModificationError();
  return { id: reviewId, status: targetStatus };
}

/** Approves a review: flips it to APPROVED, stamps the moderator/time, logs
 * the audit event, and revalidates the product's cache tags so the
 * storefront reviews list and rating summary reflect it. */
export async function approveReview(
  reviewId: string,
  moderatorUserId: string,
  options: ModerationOptions = {},
): Promise<ModeratedReview> {
  const existing = await loadReviewWithProductSlug(reviewId);

  const review = await writeReviewStatus(reviewId, "APPROVED", moderatorUserId, options.fromStatus);

  await logAuditEvent({
    userId: moderatorUserId,
    action: "approve",
    entity: "review",
    entityId: reviewId,
    metadata: { previousStatus: options.fromStatus ?? existing.status },
  });

  revalidateProductReviews(existing.product.slug);

  return review;
}

/**
 * Rejects a review: flips it to REJECTED, stamps the moderator/time, and
 * logs the audit event (with the optional `reason` in the audit metadata).
 * F-203: also how an already-APPROVED review gets unpublished — the target
 * status is always REJECTED regardless of what it's moderated *from*, so
 * "reject" already doubled as "unpublish" once the admin UI started
 * offering it from the Approved tab too (see reviews-admin-client.tsx).
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
  options: ModerationOptions = {},
): Promise<ModeratedReview> {
  const existing = await loadReviewWithProductSlug(reviewId);

  const review = await writeReviewStatus(reviewId, "REJECTED", moderatorUserId, options.fromStatus);

  await logAuditEvent({
    userId: moderatorUserId,
    action: "reject",
    entity: "review",
    entityId: reviewId,
    metadata: { previousStatus: options.fromStatus ?? existing.status, reason: reason ?? null },
  });

  // An APPROVED review being unpublished (F-203) *is* a live-cache change;
  // a PENDING one never was public in the first place. Revalidating
  // unconditionally costs little either way and keeps this function's
  // cache behavior simple rather than branching on the previous status.
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

export interface BulkRejectResult {
  rejectedIds: string[];
  notFoundIds: string[];
}

/** F-203: the reject counterpart to bulkApprove, for the "Reject N
 * selected" bulk action — same skip-and-report-unknown-ids behavior. */
export async function bulkReject(
  reviewIds: string[],
  moderatorUserId: string,
  reason?: string,
): Promise<BulkRejectResult> {
  const rejectedIds: string[] = [];
  const notFoundIds: string[] = [];

  for (const reviewId of reviewIds) {
    try {
      const result = await rejectReview(reviewId, moderatorUserId, reason);
      rejectedIds.push(result.id);
    } catch (error) {
      if (error instanceof ReviewNotFoundError) {
        notFoundIds.push(reviewId);
        continue;
      }
      throw error;
    }
  }

  return { rejectedIds, notFoundIds };
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
