"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { humanizeHermesLabel } from "@/lib/hermes/labels";

export function HermesApprovalActions({
  approvalId,
  currentStatus,
  itemTitle,
  canApprove = true,
}: {
  approvalId: string;
  currentStatus: string;
  /** The queue item this acts on — names the Approve/Reject buttons for
   * assistive tech, since the queue renders a pair of them per item. */
  itemTitle?: string;
  /** F-293: false when this role lacks the permission of the record that
   * approving would create (e.g. a campaign draft without campaign access). */
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (currentStatus !== "PENDING") {
    return (
      <span className="rounded-full bg-lavender/60 px-3 py-1 text-xs font-semibold text-muted">
        {humanizeHermesLabel(currentStatus)}
      </span>
    );
  }

  const update = async (status: "APPROVED" | "REJECTED") => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/hermes/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        // F-293: a 403 (no permission for this item type) used to be swallowed —
        // the button just appeared to do nothing.
        const body = await response.json().catch(() => ({}));
        setError(body?.error ?? "Couldn't update this approval.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {canApprove ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => update("APPROVED")}
            aria-label={itemTitle ? `Approve ${itemTitle}` : undefined}
            className="rounded-full bg-trust px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Approve
          </button>
        ) : (
          <span className="rounded-full bg-lavender/60 px-3 py-1 text-xs font-semibold text-muted">
            Your role can&apos;t approve this
          </span>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => update("REJECTED")}
          aria-label={itemTitle ? `Reject ${itemTitle}` : undefined}
          className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
