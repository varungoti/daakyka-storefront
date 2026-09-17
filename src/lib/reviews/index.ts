import { db } from "@/lib/db";

/**
 * Phase C5: read-only review data for the storefront product page.
 * Review *submission* (POST /api/reviews) and customer auth are Phase D1
 * /D2 — not built here. Every exported read helper only ever returns
 * `status: APPROVED` reviews, and is written to fail soft (empty result,
 * never throw) so a product page never 500s over the reviews section —
 * matching the fallback style already used by src/lib/products/index.ts
 * and src/lib/settings/index.ts.
 */

export type ReviewSort = "newest" | "highest" | "lowest";

export interface ReviewPhoto {
  url: string;
  alt?: string;
}

export interface DisplayReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewerName: string;
  verifiedPurchase: boolean;
  createdAt: string;
  photos: ReviewPhoto[];
}

export interface ReviewHistogram {
  5: number;
  4: number;
  3: number;
  2: number;
  1: number;
}

export interface ReviewSummary {
  average: number;
  count: number;
  histogram: ReviewHistogram;
}

export interface GetApprovedReviewsOptions {
  sort?: ReviewSort;
  page?: number;
  pageSize?: number;
}

export interface GetApprovedReviewsResult {
  reviews: DisplayReview[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const DEFAULT_REVIEWS_PAGE_SIZE = 10;

/**
 * Pure histogram/average math over a list of ratings — extracted so it's
 * unit-testable without a database. `getReviewSummary` below is a thin
 * DB-backed wrapper around this.
 */
export function computeReviewSummary(ratings: number[]): ReviewSummary {
  const histogram: ReviewHistogram = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

  for (const rating of ratings) {
    const bucket = Math.min(5, Math.max(1, Math.round(rating))) as 1 | 2 | 3 | 4 | 5;
    histogram[bucket] += 1;
  }

  const count = ratings.length;
  const average = count > 0 ? ratings.reduce((sum, r) => sum + r, 0) / count : 0;

  return { average, count, histogram };
}

/**
 * "First name + last initial" (e.g. "Priya S.") so a review shows who
 * left it without exposing a customer's full name; falls back to
 * "Anonymous" for a blank/unexpected name.
 */
export function anonymizeReviewerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Anonymous";
  const [first, second] = parts;
  if (!second) return first;
  return `${first} ${second[0].toUpperCase()}.`;
}

export async function getReviewSummary(productId: string): Promise<ReviewSummary> {
  try {
    const rows = await db.review.findMany({
      where: { productId, status: "APPROVED" },
      select: { rating: true },
    });
    return computeReviewSummary(rows.map((row) => row.rating));
  } catch {
    return computeReviewSummary([]);
  }
}

async function resolveReviewPhotos(photoIds: string[]): Promise<Map<string, ReviewPhoto>> {
  if (photoIds.length === 0) return new Map();
  try {
    const assets = await db.mediaAsset.findMany({
      where: { id: { in: photoIds } },
      select: { id: true, url: true, alt: true },
    });
    return new Map(assets.map((asset) => [asset.id, { url: asset.url, alt: asset.alt ?? undefined }]));
  } catch {
    return new Map();
  }
}

function sortOrderFor(sort: ReviewSort | undefined) {
  if (sort === "highest") {
    return [{ rating: "desc" as const }, { createdAt: "desc" as const }];
  }
  if (sort === "lowest") {
    return [{ rating: "asc" as const }, { createdAt: "desc" as const }];
  }
  return [{ createdAt: "desc" as const }];
}

/** Approved reviews for a product, paginated and sorted. Returns an
 * empty result (not a throw) for a product with zero reviews, and when
 * the DB read fails for any reason. */
export async function getApprovedReviews(
  productId: string,
  options: GetApprovedReviewsOptions = {},
): Promise<GetApprovedReviewsResult> {
  const page = options.page && options.page > 0 ? Math.floor(options.page) : 1;
  const pageSize = options.pageSize && options.pageSize > 0 ? Math.floor(options.pageSize) : DEFAULT_REVIEWS_PAGE_SIZE;

  try {
    const [rows, total] = await Promise.all([
      db.review.findMany({
        where: { productId, status: "APPROVED" },
        include: { customer: { select: { name: true } } },
        orderBy: sortOrderFor(options.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.review.count({ where: { productId, status: "APPROVED" } }),
    ]);

    const allPhotoIds = [...new Set(rows.flatMap((row) => row.photoIds))];
    const photoMap = await resolveReviewPhotos(allPhotoIds);

    const reviews: DisplayReview[] = rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      reviewerName: anonymizeReviewerName(row.customer.name),
      verifiedPurchase: row.verifiedPurchase,
      createdAt: row.createdAt.toISOString(),
      photos: row.photoIds
        .map((id) => photoMap.get(id))
        .filter((photo): photo is ReviewPhoto => Boolean(photo)),
    }));

    return { reviews, total, page, pageSize, hasMore: page * pageSize < total };
  } catch {
    return { reviews: [], total: 0, page, pageSize, hasMore: false };
  }
}
