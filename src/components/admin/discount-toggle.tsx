"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Quick active/deactivate toggle for the discounts list, without leaving
 * the page for the full edit form — same pattern as OfferToggle
 * (src/components/admin/offer-toggle.tsx). */
export function DiscountToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/discounts/${id}`, {
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
      // F-243 fix: `text-trust` is ~2.8:1 on `bg-trust/15`, below WCAG
      // AA's 4.5:1 — `text-trust-ink` is the existing F-299 token built
      // for exactly this (~6:1 on the same tint).
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-trust/15 text-trust-ink hover:bg-trust/25" : "bg-lavender/60 text-muted hover:bg-lavender"
      }`}
    >
      {busy ? "…" : active ? "Active" : "Inactive"}
    </button>
  );
}
