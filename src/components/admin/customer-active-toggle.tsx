"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminRequest } from "@/lib/admin/request";

export function CustomerActiveToggle({ customerId, active }: { customerId: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !active;
    if (next === false) {
      const confirmed = window.confirm(
        "Deactivate this customer? This signs them out of every existing session immediately.",
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/customers/${customerId}`, "Couldn't change the customer's status.", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change the customer's status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
        active ? "border border-red-300 text-red-700 hover:bg-red-50" : "bg-brand text-white"
      }`}
    >
      {busy ? "Saving…" : active ? "Deactivate customer" : "Reactivate customer"}
    </button>
      {error && <p role="alert" className="mt-2 basis-full text-xs text-red-700">{error}</p>}
    </>
  );
}
