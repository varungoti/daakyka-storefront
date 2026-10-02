import type { AdminReviewRow, ListReviewsForAdminResult } from "@/lib/reviews/moderate-review";

/**
 * F-203: the list-state and action rules behind the review moderation page
 * (src/app/admin/(panel)/reviews/reviews-admin-client.tsx) as plain
 * functions — no React, no fetch, and only *types* from moderate-review.ts
 * (which pulls in Prisma) — so they can be unit-tested without a browser or
 * a database. The component keeps the state and the requests; every
 * decision about what a list looks like after a page load or a moderation
 * lives here.
 */

export type ReviewStatus = AdminReviewRow["status"];
export type ReviewStatusFilter = ReviewStatus | "ALL";
export type ReviewAction = "approve" | "reject";

/** `?status=…&page=…` for GET /api/admin/reviews. "ALL" sends no status, and
 * page 1 sends no page — the route already assumes both defaults, so the
 * common (first-page) request URL stays exactly as it was before paging. */
export function reviewsQueryString(status: ReviewStatusFilter, page: number): string {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function dedupeReviewsById(rows: AdminReviewRow[]): AdminReviewRow[] {
  const seen = new Set<string>();
  const result: AdminReviewRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

/** "Load more": the next page's rows go after the ones already shown. Paging
 * past a filtered tab whose rows have since been moderated can overlap with
 * what is already on screen (the server-side offset moved), so rows are
 * de-duplicated by id; `hasMore`/`page`/`total` come from the newest page. */
export function appendReviewsPage(
  current: ListReviewsForAdminResult,
  nextPage: ListReviewsForAdminResult,
): ListReviewsForAdminResult {
  return { ...nextPage, reviews: dedupeReviewsById([...current.reviews, ...nextPage.reviews]) };
}

/** Drops moderated rows from a status-filtered list (they no longer match
 * the filter) and keeps the "Showing N of M" total honest. */
export function removeReviews(data: ListReviewsForAdminResult, ids: string[]): ListReviewsForAdminResult {
  return {
    ...data,
    reviews: data.reviews.filter((review) => !ids.includes(review.id)),
    total: Math.max(0, data.total - ids.length),
  };
}

/** The "All" tab keeps every row, so a moderated review just changes status
 * in place. */
export function setReviewStatuses(
  data: ListReviewsForAdminResult,
  ids: string[],
  status: ReviewStatus,
): ListReviewsForAdminResult {
  return {
    ...data,
    reviews: data.reviews.map((review) => (ids.includes(review.id) ? { ...review, status } : review)),
  };
}

/** True when removing `handledCount` of the `visibleCount` loaded rows empties
 * a filtered view that still has more reviews behind it (`total` counts the
 * whole filter) — the list must then be re-fetched from page 1, or the
 * moderator sees "No reviews in this view" with the rest of the queue
 * unreachable until they click the tab again. */
export function viewNeedsRefill(visibleCount: number, total: number, handledCount: number): boolean {
  return visibleCount <= handledCount && total - handledCount > 0;
}

/** The status a review ends up in after an action. */
export function statusAfter(action: ReviewAction): ReviewStatus {
  return action === "approve" ? "APPROVED" : "REJECTED";
}

/** Only PENDING reviews can be selected for a bulk action; "select all"
 * covers the pending rows currently shown, and is "all selected" only when
 * there is at least one and every one is. */
export function pendingSelection(
  reviews: AdminReviewRow[],
  selected: ReadonlySet<string>,
): { pendingIds: string[]; allSelected: boolean } {
  const pendingIds = reviews.filter((review) => review.status === "PENDING").map((review) => review.id);
  return { pendingIds, allSelected: pendingIds.length > 0 && pendingIds.every((id) => selected.has(id)) };
}

export interface ReviewRowAction {
  action: ReviewAction;
  label: string;
  /** "primary" is the filled brand button (publishing something); "secondary"
   * is the outlined one (taking something down). */
  tone: "primary" | "secondary";
}

/** Every status has something a moderator can do: Approve/Reject for a
 * PENDING review, Unpublish (a reject) for a live APPROVED one, and Restore
 * (an approve) for a REJECTED one. */
export function reviewRowActions(status: ReviewStatus): ReviewRowAction[] {
  switch (status) {
    case "PENDING":
      return [
        { action: "approve", label: "Approve", tone: "primary" },
        { action: "reject", label: "Reject", tone: "secondary" },
      ];
    case "APPROVED":
      return [{ action: "reject", label: "Unpublish", tone: "secondary" }];
    case "REJECTED":
      return [{ action: "approve", label: "Restore", tone: "primary" }];
  }
}

/** The confirm() text for an action, or null when it needs none. Only the
 * two that change what is already live or already gone ask: unpublishing an
 * approved review (its photos are deleted — F-362 — which Restore can't
 * undo) and restoring a rejected one. Approving or rejecting a PENDING
 * review is the everyday queue work and never asks. */
export function reviewActionConfirmMessage(
  status: ReviewStatus,
  action: ReviewAction,
  photoCount: number,
): string | null {
  if (status === "APPROVED" && action === "reject") {
    const photoNote = photoCount > 0 ? " Its photos will be permanently deleted." : "";
    return `Unpublish this review from the product page?${photoNote}`;
  }
  if (status === "REJECTED" && action === "approve") {
    return "Restore and publish this review? Any photos it had were deleted when it was rejected.";
  }
  return null;
}
