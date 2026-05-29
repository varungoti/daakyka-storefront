"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HermesApprovalActions({
  approvalId,
  currentStatus,
}: {
  approvalId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (currentStatus !== "PENDING") {
    return (
      <span className="rounded-full bg-lavender/60 px-3 py-1 text-xs font-semibold text-muted">
        {currentStatus}
      </span>
    );
  }

  const update = async (status: "APPROVED" | "REJECTED") => {
    setLoading(true);
    await fetch(`/api/admin/hermes/approvals/${approvalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
    setLoading(false);
  };

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => update("APPROVED")}
        className="rounded-full bg-trust px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => update("REJECTED")}
        className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
