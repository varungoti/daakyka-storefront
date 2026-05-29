"use client";

import { useRouter } from "next/navigation";

const statusOptions = ["DRAFT", "ACTIVE", "PAUSED"] as const;

export function JourneyStatusSelect({
  journeyId,
  currentStatus,
}: {
  journeyId: string;
  currentStatus: string;
}) {
  const router = useRouter();

  const handleChange = async (status: string) => {
    await fetch(`/api/admin/journeys/${journeyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  };

  return (
    <select
      value={currentStatus}
      onChange={(event) => handleChange(event.target.value)}
      className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold outline-none focus:border-brand"
    >
      {statusOptions.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}
