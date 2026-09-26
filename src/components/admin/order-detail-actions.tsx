"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORDER_STATUS_TRANSITIONS } from "@/lib/orders/status-transitions";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

interface Props {
  orderId: string;
  currentStatus: OrderStatus;
  trackingNumber: string | null;
  courier: string | null;
  adminNotes: string | null;
  canManage: boolean;
  /** F-282 fix: needed to decide whether cancelling/refunding this order
   * needs the "this doesn't refund the customer" acknowledgement below. */
  paymentMethod: PaymentMethod;
  hasCapturedPayment: boolean;
  razorpayPaymentUrl: string | null;
  /** F-339 fix: the order's `updatedAt` as loaded onto this page — sent
   * back with every save so a stale tab (a colleague saved a change since
   * this page was loaded) gets a conflict instead of silently overwriting
   * whatever it touched. */
  updatedAt: string;
}

/**
 * Phase D4: order detail status/tracking/admin-notes control. The dropdown
 * only offers statuses the transition matrix (src/lib/orders/status-transitions.ts)
 * actually allows from the current status — the server re-validates the
 * same matrix regardless, but this keeps the admin from picking an option
 * that's only going to bounce back as a 400.
 */
export function OrderDetailActions({
  orderId,
  currentStatus,
  trackingNumber,
  courier,
  adminNotes,
  canManage,
  paymentMethod,
  hasCapturedPayment,
  razorpayPaymentUrl,
  updatedAt,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus>(currentStatus);
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const [courierName, setCourierName] = useState(courier ?? "");
  const [notes, setNotes] = useState(adminNotes ?? "");
  const [acknowledgeExternalRefund, setAcknowledgeExternalRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nextStatuses = ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];
  const willShip = status === "SHIPPED" && status !== currentStatus;
  // F-205 fix: tracking used to render only for `willShip || currentStatus
  // === "SHIPPED"` — so it vanished from the page entirely the moment an
  // order reached DELIVERED (or CANCELLED/REFUNDED after shipping), even
  // though `trackingNumber`/`courier` are still sitting right there on the
  // order. Now shown whenever there's tracking info to show, or a pending
  // change to SHIPPED that needs it entered.
  const showTracking = willShip || currentStatus === "SHIPPED" || Boolean(trackingNumber || courier);
  // Editable only while actually shipping or already SHIPPED — DELIVERED
  // (and any other status) shows the same fields read-only, so a courier
  // typo can't be "corrected" into a false record after the fact from this
  // form (tracking can still be fixed by an explicit status round-trip if
  // truly needed).
  const trackingEditable = canManage && (willShip || currentStatus === "SHIPPED");
  // F-282 fix: a paid Razorpay order's status has never moved any money —
  // nothing in this codebase calls Razorpay's refund API. Cancelling or
  // refunding one needs an explicit "I understand" before Save is even
  // enabled, so an admin used to Shopify (where this action *does* refund)
  // never assumes it happened here too.
  const needsRefundAcknowledgement =
    paymentMethod === "RAZORPAY" &&
    hasCapturedPayment &&
    status !== currentStatus &&
    (status === "CANCELLED" || status === "REFUNDED");
  const notesChanged = notes !== (adminNotes ?? "");

  async function save() {
    // F-205 fix: choosing CANCELLED/REFUNDED and pressing Save used to
    // apply instantly with no confirmation, even though the transition is
    // final (status-transitions.ts has no outgoing edges from either) and,
    // for stock already committed to the order, restocks it immediately.
    // Other destructive admin actions in this codebase (delete-button.tsx,
    // user-role-editor.tsx, category-tree.tsx) already confirm first — this
    // brings order cancellation in line with them.
    if (status !== currentStatus && (status === "CANCELLED" || status === "REFUNDED")) {
      const willRestock =
        paymentMethod === "ORDER_REQUEST" || (paymentMethod === "RAZORPAY" && hasCapturedPayment);
      const verb = status === "CANCELLED" ? "cancel" : "refund";
      const confirmed = window.confirm(
        `Are you sure you want to ${verb} this order? This cannot be undone.` +
          (willRestock ? " Stock reserved for it will be restored to inventory." : ""),
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);

    const body: Record<string, unknown> = { updatedAt };
    // F-339 fix: only send adminNotes when this admin actually changed it
    // — previously this always re-sent whatever the textarea loaded with,
    // so saving a status change from a tab opened before a colleague's
    // note edit silently wiped that note.
    if (notesChanged) body.adminNotes = notes;
    if (status !== currentStatus) body.status = status;
    if (tracking.trim()) body.trackingNumber = tracking.trim();
    if (courierName.trim()) body.courier = courierName.trim();
    if (needsRefundAcknowledgement) body.acknowledgeExternalRefund = acknowledgeExternalRefund;

    const response = await fetch(`/api/admin/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusy(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setError("This order changed since the page loaded — reload and try again.");
      } else {
        setError(payload?.error ?? "Couldn't save changes.");
      }
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

      {needsRefundAcknowledgement && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">
            This only changes the order status — it does NOT refund the customer.
          </p>
          <p>
            Nothing here calls Razorpay.{" "}
            {razorpayPaymentUrl ? (
              <a href={razorpayPaymentUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                Refund this payment in the Razorpay dashboard
              </a>
            ) : (
              "Refund this payment in the Razorpay dashboard"
            )}{" "}
            first if the customer should get their money back.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={acknowledgeExternalRefund}
              onChange={(e) => setAcknowledgeExternalRefund(e.target.checked)}
              className="mt-0.5"
            />
            <span>I understand this does not refund the customer.</span>
          </label>
        </div>
      )}

      {showTracking && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Tracking number{willShip ? " *" : ""}</label>
            <input
              value={tracking}
              disabled={!trackingEditable}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="e.g. 1234567890"
              className="w-full rounded-xl border border-border p-2 text-sm disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Courier{willShip ? " *" : ""}</label>
            <input
              value={courierName}
              disabled={!trackingEditable}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="e.g. Bluedart"
              className="w-full rounded-xl border border-border p-2 text-sm disabled:opacity-60"
            />
          </div>
          {!trackingEditable && <p className="sm:col-span-2 text-xs text-muted">Read-only once the order has moved past shipping.</p>}
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
          disabled={busy || (needsRefundAcknowledgement && !acknowledgeExternalRefund)}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      )}
    </div>
  );
}
