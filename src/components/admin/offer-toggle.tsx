"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Quick active/inactive toggle for the offers list, without leaving the
 * page for the full edit form — closes the audit gap "Offers can't be
 * toggled". */
export function OfferToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-trust/15 text-trust hover:bg-trust/25" : "bg-lavender/60 text-muted hover:bg-lavender"
      }`}
    >
      {busy ? "…" : active ? "Active" : "Inactive"}
    </button>
  );
}
