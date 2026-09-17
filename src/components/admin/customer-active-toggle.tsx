"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CustomerActiveToggle({ customerId, active }: { customerId: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !active;
    if (next === false) {
      const confirmed = window.confirm(
        "Deactivate this customer? This signs them out of every existing session immediately.",
      );
      if (!confirmed) return;
    }
    setBusy(true);
    await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
        active ? "border border-red-300 text-red-700 hover:bg-red-50" : "bg-brand text-white"
      }`}
    >
      {busy ? "Saving…" : active ? "Deactivate customer" : "Reactivate customer"}
    </button>
  );
}
