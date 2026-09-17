"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORDER_STATUS_TRANSITIONS } from "@/lib/orders/status-transitions";
import type { OrderStatus } from "@/generated/prisma/client";

interface Props {
  orderId: string;
  currentStatus: OrderStatus;
  trackingNumber: string | null;
  courier: string | null;
  adminNotes: string | null;
  canManage: boolean;
}

/**
 * Phase D4: order detail status/tracking/admin-notes control. The dropdown
 * only offers statuses the transition matrix (src/lib/orders/status-transitions.ts)
 * actually allows from the current status — the server re-validates the
 * same matrix regardless, but this keeps the admin from picking an option
 * that's only going to bounce back as a 400.
 */
export function OrderDetailActions({ orderId, currentStatus, trackingNumber, courier, adminNotes, canManage }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus>(currentStatus);
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const [courierName, setCourierName] = useState(courier ?? "");
  const [notes, setNotes] = useState(adminNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nextStatuses = ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];
  const willShip = status === "SHIPPED" && status !== currentStatus;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const body: Record<string, unknown> = { adminNotes: notes };
    if (status !== currentStatus) body.status = status;
    if (tracking.trim()) body.trackingNumber = tracking.trim();
    if (courierName.trim()) body.courier = courierName.trim();

    const response = await fetch(`/api/admin/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusy(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload?.error ?? "Couldn't save changes.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-display text-lg font-bold text-ink">Manage order</h2>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Status</label>
        <select
          value={status}
          disabled={!canManage}
          onChange={(e) => setStatus(e.target.value as OrderStatus)}
          className="w-full rounded-xl border border-border p-2 text-sm disabled:opacity-60"
        >
          <option value={currentStatus}>{currentStatus.replace("_", " ")} (current)</option>
          {nextStatuses.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        {nextStatuses.length === 0 && <p className="mt-1 text-xs text-muted">This is a final status — no further transitions.</p>}
      </div>

      {(willShip || currentStatus === "SHIPPED") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Tracking number{willShip ? " *" : ""}</label>
            <input
              value={tracking}
              disabled={!canManage}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="e.g. 1234567890"
              className="w-full rounded-xl border border-border p-2 text-sm disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Courier{willShip ? " *" : ""}</label>
            <input
              value={courierName}
              disabled={!canManage}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="e.g. Bluedart"
              className="w-full rounded-xl border border-border p-2 text-sm disabled:opacity-60"
            />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Admin notes</label>
        <textarea
          value={notes}
          disabled={!canManage}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Internal notes — not visible to the customer."
          className="w-full rounded-xl border border-border p-2 text-sm disabled:opacity-60"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && !error && <p className="text-xs text-green-700">Saved.</p>}

      {canManage && (
        <button
          onClick={save}
          disabled={busy}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      )}
    </div>
  );
}
