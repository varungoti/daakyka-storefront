"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatApiError } from "@/lib/validation/format-api-error";

const statusOptions = ["DRAFT", "ACTIVE", "PAUSED"] as const;

export function JourneyStatusSelect({
  journeyId,
  currentStatus,
}: {
  journeyId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleChange = async (status: string) => {
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/journeys/${journeyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        // F-219: the response used to be ignored entirely, so a rejected
        // change (e.g. the journey was deleted meanwhile) looked like it
        // had worked. `value` below is controlled by the server-rendered
        // `currentStatus`, so the select snaps back to what's really saved.
        const body = await response.json().catch(() => ({}));
        setErrorMessage(formatApiError(body, "Couldn't update this journey.").summary);
        return;
      }
    } catch {
      setErrorMessage("Couldn't update this journey — check your connection.");
      return;
    }
    router.refresh();
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <select
        value={currentStatus}
        onChange={(event) => handleChange(event.target.value)}
        aria-label="Journey status"
        className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold outline-none focus:border-brand"
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {errorMessage ? (
        <span role="alert" className="text-[11px] text-red-600">
          {errorMessage}
        </span>
      ) : null}
    </span>
  );
}
