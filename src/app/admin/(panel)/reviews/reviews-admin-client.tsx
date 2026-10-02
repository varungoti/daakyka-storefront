"use client";

import { StarRating } from "@/components/ui/star-rating";
import type { LightboxImage } from "@/components/ui/image-lightbox";
import { cn } from "@/lib/utils";
import type { AdminReviewRow, ListReviewsForAdminResult } from "@/lib/reviews/moderate-review";
import {
  appendReviewsPage,
  pendingSelection,
  removeReviews,
  reviewActionConfirmMessage,
  reviewRowActions,
  reviewsQueryString,
  setReviewStatuses,
  statusAfter,
  viewNeedsRefill,
  type ReviewAction,
  type ReviewStatusFilter,
} from "@/lib/reviews/admin-list-state";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

// Same reasoning as product-detail.tsx's own dynamic import: the full-screen
// viewer is only ever mounted once a moderator clicks a review photo
// (F-360), so there's no reason to ship its code in this page's main bundle.
const ImageLightbox = dynamic(() => import("@/components/ui/image-lightbox").then((mod) => mod.ImageLightbox), {
  ssr: false,
});

const TABS: { value: ReviewStatusFilter; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

export function ReviewsAdminClient({
  initialData,
  initialStatus,
}: {
  initialData: ListReviewsForAdminResult;
  initialStatus: ReviewStatusFilter;
}) {
  const [status, setStatus] = useState<ReviewStatusFilter>(initialStatus);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // F-360: which review's photos are open in the full-screen viewer.
  const [photoLightbox, setPhotoLightbox] = useState<{ photos: LightboxImage[]; index: number } | null>(null);

  /** F-203: (re)loads page 1 of `nextStatus` — every tab click, and every
   * refetch after an action leaves the current view empty while more
   * reviews remain (see moderate/bulk* below). The list-state rules live in
   * src/lib/reviews/admin-list-state.ts, where they're unit-tested. */
  async function loadStatus(nextStatus: ReviewStatusFilter) {
    setStatus(nextStatus);
    setSelected(new Set());
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews${reviewsQueryString(nextStatus, 1)}`);
      if (!response.ok) throw new Error("Failed to load reviews");
      const result = (await response.json()) as ListReviewsForAdminResult;
      setData(result);
    } catch {
      setError("Could not load reviews. Try again.");
    } finally {
      setLoading(false);
    }
  }

  /** F-203: the moderation queue used to hard-code 20 results with no way
   * to reach anything past them — `hasMore`/`page` were already returned by
   * listReviewsForAdmin, nothing here ever asked for page 2. */
  async function loadMore() {
    if (!data.hasMore || loadingMore) return;
    const nextPage = data.page + 1;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews${reviewsQueryString(status, nextPage)}`);
      if (!response.ok) throw new Error("Failed to load reviews");
      const result = (await response.json()) as ListReviewsForAdminResult;
      setData((prev) => appendReviewsPage(prev, result));
    } catch {
      setError("Could not load more reviews. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function removeFromList(ids: string[]) {
    setData((prev) => removeReviews(prev, ids));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  async function moderate(id: string, action: ReviewAction, fromStatus: AdminReviewRow["status"]) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, fromStatus }),
      });
      if (!response.ok) {
        // F-343: another admin already moderated this review since this
        // tab last loaded it — reload the view instead of pretending the
        // click did anything.
        if (response.status === 409) {
          setError("Someone else already moderated this review — the list has been refreshed.");
          await loadStatus(status);
          return;
        }
        throw new Error("Moderation failed");
      }
      // The review no longer belongs in the current filtered view (unless
      // viewing "All", where its status just changed in place) — simplest
      // correct behavior is to drop it from a status-filtered list and
      // patch it in place for "All".
      if (status === "ALL") {
        setData((prev) => setReviewStatuses(prev, [id], statusAfter(action)));
      } else {
        // F-203: once this was the last row visible in a filtered tab,
        // dropping it would show "No reviews in this view" even though
        // `total` (now minus this one) is still above zero — reload page 1
        // instead of leaving the rest of the queue unreachable until the
        // admin clicks the tab again.
        const needsRefill = viewNeedsRefill(data.reviews.length, data.total, 1);
        removeFromList([id]);
        if (needsRefill) await loadStatus(status);
      }
    } catch {
      setError("Could not update that review. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function bulkModerateSelected(action: ReviewAction) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/reviews/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      if (!response.ok) throw new Error("Bulk action failed");
      const result = (await response.json()) as { approvedIds?: string[]; rejectedIds?: string[] };
      const handledIds = action === "approve" ? (result.approvedIds ?? []) : (result.rejectedIds ?? []);
      if (status === "ALL") {
        setData((prev) => setReviewStatuses(prev, handledIds, statusAfter(action)));
        setSelected(new Set());
      } else {
        const needsRefill = viewNeedsRefill(data.reviews.length, data.total, handledIds.length);
        removeFromList(handledIds);
        if (needsRefill) await loadStatus(status);
      }
    } catch {
      setError(`Bulk ${action === "approve" ? "approve" : "reject"} failed. Try again.`);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { pendingIds: pendingVisibleIds, allSelected: allPendingSelected } = pendingSelection(data.reviews, selected);

  function toggleSelectAllPending() {
    setSelected(allPendingSelected ? new Set() : new Set(pendingVisibleIds));
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPhotoLightbox(photos: AdminReviewRow["photos"], index: number) {
    setPhotoLightbox({ photos: photos.map((p) => ({ url: p.url, alt: p.alt ?? undefined })), index });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => void loadStatus(tab.value)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
                status === tab.value
                  ? "border-ink bg-ink text-white"
                  : "border-border text-muted hover:border-ink hover:text-ink",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void bulkModerateSelected("approve")}
              disabled={loading}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Approve {selected.size} selected
            </button>
            <button
              type="button"
              onClick={() => void bulkModerateSelected("reject")}
              disabled={loading}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-red-400 hover:text-red-600 disabled:opacity-50"
            >
              Reject {selected.size} selected
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.reviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          No reviews in this view.
        </div>
      ) : (
        <>
          {pendingVisibleIds.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-medium text-muted">
              <input
                type="checkbox"
                checked={allPendingSelected}
                onChange={toggleSelectAllPending}
                className="h-4 w-4"
                aria-label="Select all pending reviews shown"
              />
              Select all pending
            </label>
          )}
          <ul className="space-y-3">
            {data.reviews.map((review) => (
              <ReviewRow
                key={review.id}
                review={review}
                selected={selected.has(review.id)}
                expanded={expanded.has(review.id)}
                busy={busyId === review.id}
                onToggleSelect={() => toggleSelected(review.id)}
                onToggleExpand={() => toggleExpanded(review.id)}
                onAction={(action) => void moderate(review.id, action, review.status)}
                onOpenPhoto={(index) => openPhotoLightbox(review.photos, index)}
              />
            ))}
          </ul>
        </>
      )}

      {!loading && data.reviews.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-xs text-muted">
            Showing {data.reviews.length} of {data.total}
          </p>
          {data.hasMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}

      {photoLightbox && (
        <ImageLightbox
          images={photoLightbox.photos}
          startIndex={photoLightbox.index}
          onClose={() => setPhotoLightbox(null)}
        />
      )}
    </div>
  );
}

function ReviewRow({
  review,
  selected,
  expanded,
  busy,
  onToggleSelect,
  onToggleExpand,
  onAction,
  onOpenPhoto,
}: {
  review: AdminReviewRow;
  selected: boolean;
  expanded: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onAction: (action: ReviewAction) => void;
  onOpenPhoto: (index: number) => void;
}) {
  const bodyPreview =
    review.body.length > 160 && !expanded ? `${review.body.slice(0, 160)}…` : review.body;

  // F-203: every status now has *some* action (reviewRowActions) — Approve/
  // Reject for a PENDING review, "Unpublish" (reject) for a live APPROVED
  // one, and "Restore" (approve) for a REJECTED one. Only the PENDING pair
  // skips the confirm() — unpublishing or restoring changes what's already
  // live/dead on a product page, so a moderator gets one chance to back out
  // of a misclick. F-362: rejecting (or unpublishing) a review deletes its
  // photos from storage so they stop being publicly downloadable — which
  // Restore can't undo — so the confirm says so.
  function runAction(action: ReviewAction) {
    const confirmMessage = reviewActionConfirmMessage(review.status, action, review.photos.length);
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    onAction(action);
  }

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start gap-4">
        {review.status === "PENDING" && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1.5 h-4 w-4"
            aria-label={`Select review from ${review.customer.name}`}
          />
        )}

        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-alt-surface">
          {review.product.image ? (
            <Image src={review.product.image} alt={review.product.name} fill className="object-cover" sizes="56px" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted">No image</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/products/${review.product.slug}`} className="font-semibold text-ink hover:underline">
              {review.product.name}
            </Link>
            <StatusBadge status={review.status} />
            {review.verifiedPurchase && (
              <span className="rounded-full bg-trust/10 px-2 py-0.5 text-xs font-semibold text-trust">
                Verified Buyer
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <StarRating rating={review.rating} size="sm" />
            <span>·</span>
            <span>{review.customer.name}</span>
            <span>·</span>
            <span>{new Date(review.createdAt).toLocaleDateString("en-IN")}</span>
          </div>

          {review.title && <p className="mt-2 font-semibold text-ink">{review.title}</p>}
          <p className="mt-1 text-sm leading-relaxed text-muted">{bodyPreview}</p>
          {review.body.length > 160 && (
            <button type="button" onClick={onToggleExpand} className="mt-1 text-xs font-semibold text-brand">
              {expanded ? "Show less" : "Show more"}
            </button>
          )}

          {review.photos.length > 0 && (
            <div className="mt-3 flex gap-2">
              {review.photos.map((photo, index) => (
                <button
                  key={`${photo.url}-${index}`}
                  type="button"
                  onClick={() => onOpenPhoto(index)}
                  className="relative h-14 w-14 overflow-hidden rounded-lg border border-border transition hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  aria-label={`View photo ${index + 1} of ${review.photos.length} at full size`}
                >
                  <Image src={photo.url} alt={photo.alt ?? "Review photo"} fill className="object-cover" sizes="56px" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* F-207: on its own row (full width) below `sm`, so the text
            column above keeps the full card width instead of being
            squeezed to ~80px next to these buttons. */}
        <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
          {reviewRowActions(review.status).map((rowAction) => (
            <button
              key={rowAction.action}
              type="button"
              onClick={() => runAction(rowAction.action)}
              disabled={busy}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50",
                rowAction.tone === "primary"
                  ? "bg-brand text-white hover:opacity-90"
                  : "border border-border text-ink hover:border-red-400 hover:text-red-600",
              )}
            >
              {rowAction.label}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: AdminReviewRow["status"] }) {
  const styles: Record<AdminReviewRow["status"], string> = {
    PENDING: "bg-amber-50 text-amber-700",
    APPROVED: "bg-emerald-50 text-emerald-700",
    REJECTED: "bg-red-50 text-red-600",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", styles[status])}>{status}</span>
  );
}
