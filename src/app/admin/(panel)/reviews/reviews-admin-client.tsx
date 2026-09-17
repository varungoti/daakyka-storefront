"use client";

import { StarRating } from "@/components/ui/star-rating";
import { cn } from "@/lib/utils";
import type { AdminReviewRow, ListReviewsForAdminResult } from "@/lib/reviews/moderate-review";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

const TABS: { value: StatusFilter; label: string }[] = [
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
  initialStatus: StatusFilter;
}) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus(next: StatusFilter) {
    setStatus(next);
    setSelected(new Set());
    setLoading(true);
    setError(null);
    try {
      const qs = next === "ALL" ? "" : `?status=${next}`;
      const response = await fetch(`/api/admin/reviews${qs}`);
      if (!response.ok) throw new Error("Failed to load reviews");
      const result = (await response.json()) as ListReviewsForAdminResult;
      setData(result);
    } catch {
      setError("Could not load reviews. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function removeFromList(ids: string[]) {
    setData((prev) => ({
      ...prev,
      reviews: prev.reviews.filter((r) => !ids.includes(r.id)),
      total: Math.max(0, prev.total - ids.length),
    }));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  async function moderate(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("Moderation failed");
      // The review no longer belongs in the current filtered view (unless
      // viewing "All", where its status just changed in place) — simplest
      // correct behavior is to drop it from a status-filtered list and
      // patch it in place for "All".
      if (status === "ALL") {
        setData((prev) => ({
          ...prev,
          reviews: prev.reviews.map((r) =>
            r.id === id ? { ...r, status: action === "approve" ? "APPROVED" : "REJECTED" } : r,
          ),
        }));
      } else {
        removeFromList([id]);
      }
    } catch {
      setError("Could not update that review. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function bulkApproveSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/reviews/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", ids }),
      });
      if (!response.ok) throw new Error("Bulk approve failed");
      const result = (await response.json()) as { approvedIds: string[] };
      if (status === "ALL") {
        setData((prev) => ({
          ...prev,
          reviews: prev.reviews.map((r) =>
            result.approvedIds.includes(r.id) ? { ...r, status: "APPROVED" } : r,
          ),
        }));
        setSelected(new Set());
      } else {
        removeFromList(result.approvedIds);
      }
    } catch {
      setError("Bulk approve failed. Try again.");
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

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          <button
            type="button"
            onClick={() => void bulkApproveSelected()}
            disabled={loading}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Approve {selected.size} selected
          </button>
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
              onApprove={() => void moderate(review.id, "approve")}
              onReject={() => void moderate(review.id, "reject")}
              showActions={review.status === "PENDING" || status === "ALL"}
            />
          ))}
        </ul>
      )}

      {data.total > data.reviews.length && !loading && (
        <p className="text-center text-xs text-muted">
          Showing {data.reviews.length} of {data.total}
        </p>
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
  onApprove,
  onReject,
  showActions,
}: {
  review: AdminReviewRow;
  selected: boolean;
  expanded: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onApprove: () => void;
  onReject: () => void;
  showActions: boolean;
}) {
  const bodyPreview =
    review.body.length > 160 && !expanded ? `${review.body.slice(0, 160)}…` : review.body;

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
                <div key={`${photo.url}-${index}`} className="relative h-14 w-14 overflow-hidden rounded-lg border border-border">
                  <Image src={photo.url} alt={photo.alt ?? "Review photo"} fill className="object-cover" sizes="56px" />
                </div>
              ))}
            </div>
          )}
        </div>

        {showActions && review.status === "PENDING" && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-red-400 hover:text-red-600 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
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
