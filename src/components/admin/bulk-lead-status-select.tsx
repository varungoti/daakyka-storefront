"use client";

import type { BulkLeadStatus } from "@/generated/prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const statusOptions: BulkLeadStatus[] = ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"];

export function BulkLeadStatusSelect({
  leadId,
  leadName,
  currentStatus,
}: {
  leadId: string;
  /** The organisation this row belongs to — names the select for assistive
   * tech ("Status for Apollo Hospitals"), since the list renders one per lead. */
  leadName: string;
  currentStatus: BulkLeadStatus;
}) {
  const router = useRouter();
  // F-196: local, optimistic state — currentStatus alone (a controlled
  // select bound straight to the server-loaded prop) meant a failed PATCH
  // just silently snapped back to the old value on the next render, with
  // no indication anything went wrong.
  const [value, setValue] = useState(currentStatus);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const updateStatus = async (status: BulkLeadStatus) => {
    const previous = value;
    setValue(status);
    setPending(true);
    setFailed(false);

    try {
      const response = await fetch(`/api/admin/bulk-orders/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        setValue(previous);
        setFailed(true);
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => updateStatus(e.target.value as BulkLeadStatus)}
        aria-label={`Status for ${leadName}`}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase outline-none focus:border-brand disabled:opacity-60"
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {failed && <span className="text-[11px] font-normal normal-case text-red-600">Couldn&apos;t update. Try again.</span>}
    </div>
  );
}
