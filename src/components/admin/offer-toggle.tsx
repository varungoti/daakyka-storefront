"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatApiError } from "@/lib/validation/format-api-error";

/** Quick active/inactive toggle for the offers list, without leaving the
 * page for the full edit form — closes the audit gap "Offers can't be
 * toggled". */
export function OfferToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (response.ok) {
        router.refresh();
      } else {
        // F-219: a rejected toggle used to do nothing at all — the button
        // just stopped saying "…" and kept its old label.
        const body = await response.json().catch(() => ({}));
        setErrorMessage(formatApiError(body, "Couldn't update this offer.").summary);
      }
    } catch {
      setErrorMessage("Couldn't update this offer — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        // F-243 fix: `text-trust` is ~2.8:1 on `bg-trust/15`, below WCAG
        // AA's 4.5:1 — `text-trust-ink` is the existing F-299 token built
        // for exactly this (~6:1 on the same tint).
        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          active ? "bg-trust/15 text-trust-ink hover:bg-trust/25" : "bg-lavender/60 text-muted hover:bg-lavender"
        }`}
      >
        {busy ? "…" : active ? "Active" : "Inactive"}
      </button>
      {errorMessage ? (
        <span role="alert" className="text-[11px] text-red-600">
          {errorMessage}
        </span>
      ) : null}
    </span>
  );
}
