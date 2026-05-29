"use client";

import type { BulkLeadStatus } from "@/generated/prisma/client";
import { useRouter } from "next/navigation";

const statusOptions: BulkLeadStatus[] = ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"];

export function BulkLeadStatusSelect({
  leadId,
  currentStatus,
}: {
  leadId: string;
  currentStatus: BulkLeadStatus;
}) {
  const router = useRouter();

  const updateStatus = async (status: BulkLeadStatus) => {
    await fetch(`/api/admin/bulk-orders/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  };

  return (
    <select
      value={currentStatus}
      onChange={(e) => updateStatus(e.target.value as BulkLeadStatus)}
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase outline-none focus:border-brand"
    >
      {statusOptions.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}
