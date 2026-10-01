"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  canRecordOrderRequestPayment,
  ORDER_STATUS_TRANSITIONS,
  orderHoldsReservedStock,
} from "@/lib/orders/status-transitions";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

/** F-199 fix: how an order-request's payment was received — mirrors
 * admin-orders.ts's paymentRecordMethodValues (not imported: that module
 * is server-only). */
const PAYMENT_RECEIVED_VIA = [
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "COD", label: "Cash on delivery" },
  { value: "OTHER", label: "Other" },
] as const;

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
  /** F-199 fix: whether this order's `paidAt` is set — an order-request
   * whose payment has already been recorded can't be marked paid again. */
  paymentRecorded: boolean;
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
  paymentRecorded,
  razorpayPaymentUrl,
  updatedAt,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus>(currentStatus);
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const [courierName, setCourierName] = useState(courier ?? "");
  const [notes, setNotes] = useState(adminNotes ?? "");
  const [acknowledgeExternalRefund, setAcknowledgeExternalRefund] = useState(false);
  const [paymentMethodChoice, setPaymentMethodChoice] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [restockReturned, setRestockReturned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // F-199 fix: PROCESSING -> PAID exists in the matrix so an ORDER_REQUEST
  // order's payment can be recorded, but a RAZORPAY order only ever
  // reaches PROCESSING by having already passed through PAID — and an
  // order-request whose payment was already recorded (it went PAID ->
  // PROCESSING) has nothing left to record — so offering it there would
  // just re-stamp paidAt for a payment that already happened (the server
  // rejects it too — see admin-orders.ts's OrderRequestPaymentOnlyError).
  const nextStatuses = (ORDER_STATUS_TRANSITIONS[currentStatus] ?? []).filter(
    (s) => !(s === "PAID" && currentStatus === "PROCESSING" && (paymentMethod !== "ORDER_REQUEST" || paymentRecorded)),
  );
  const willShip = status === "SHIPPED" && status !== currentStatus;
  // F-199 fix: PROCESSING -> PAID is how an order-request's payment is
  // recorded (the only way PAID is reachable from PROCESSING in the list
  // above), so say so — and ask how the money arrived, which the order's
  // History then shows. Returning a shipped/delivered order can put the
  // goods back in stock, but only when the owner says they're sellable.
  const recordingPayment = status === "PAID" && currentStatus === "PROCESSING";
  // F-199 fix: an order-request that has already shipped (cash on delivery,
  // paid at the door) has no PAID edge to record its payment through —
  // SHIPPED and DELIVERED are fulfilment states — so the same fields are
  // offered there on their own, optionally, with no status change (or
  // together with SHIPPED -> DELIVERED). Hidden when the admin has picked
  // a return/refund: there's no payment to record on those. The server
  // applies the same rule (canRecordOrderRequestPayment).
  const recordingPaymentOnly =
    canManage &&
    (currentStatus === "SHIPPED" || currentStatus === "DELIVERED") &&
    canRecordOrderRequestPayment(paymentMethod, currentStatus, paymentRecorded) &&
    (status === currentStatus || status === "DELIVERED");
  const returning = status === "RETURNED" && status !== currentStatus;
  const refundingShippedOrder =
    status === "REFUNDED" && (currentStatus === "SHIPPED" || currentStatus === "DELIVERED");
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
    if (status !== currentStatus && (status === "CANCELLED" || status === "REFUNDED" || status === "RETURNED")) {
      // F-199 fix: the prompt promises a restock only when the server will
      // really do one — cancelling/refunding an order that hasn't shipped
      // (orderHoldsReservedStock, the same rule updateOrderAdmin applies),
      // or returning one with the "add back to stock" box ticked. A refund
      // after shipping, or RETURNED -> REFUNDED, never restocks.
      const restocks =
        status === "RETURNED" ? restockReturned : orderHoldsReservedStock(paymentMethod, currentStatus);
      const verb = status === "CANCELLED" ? "cancel" : status === "REFUNDED" ? "refund" : "mark as returned";
      const confirmed = window.confirm(
        `Are you sure you want to ${verb} this order? This cannot be undone.` +
          (restocks
            ? status === "RETURNED"
              ? " The returned items will be added back to stock."
              : " Stock reserved for it will be restored to inventory."
            : ""),
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
    if (recordingPayment || (recordingPaymentOnly && paymentMethodChoice)) {
      body.payment = {
        method: paymentMethodChoice,
        ...(paymentReference.trim() ? { reference: paymentReference.trim() } : {}),
      };
    }
    if (returning && restockReturned) body.restockReturnedItems = true;

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
              {s === "PAID" && currentStatus === "PROCESSING"
                ? "PAID — record payment received"
                : s.replace("_", " ")}
            </option>
          ))}
        </select>
        {nextStatuses.length === 0 && <p className="mt-1 text-xs text-muted">This is a final status — no further transitions.</p>}
      </div>

      {(recordingPayment || recordingPaymentOnly) && (
        <div className="space-y-3 rounded-xl border border-border bg-lavender/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {recordingPayment ? "Payment received" : "Record payment received (optional)"}
          </p>
          {recordingPaymentOnly && (
            <p className="text-xs text-muted">
              No payment has been recorded for this order yet. Choose how it was paid once the customer has paid — for
              cash on delivery, that is when the parcel is handed over.
            </p>
          )}
          <select
            value={paymentMethodChoice}
            disabled={!canManage}
            onChange={(e) => setPaymentMethodChoice(e.target.value)}
            aria-label="How was the payment received?"
            className="w-full rounded-xl border border-border bg-white p-2 text-sm disabled:opacity-60"
          >
            <option value="">{recordingPayment ? "How was it paid? *" : "Not received yet"}</option>
            {PAYMENT_RECEIVED_VIA.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={paymentReference}
            disabled={!canManage}
            maxLength={120}
            onChange={(e) => setPaymentReference(e.target.value)}
            placeholder="Reference / transaction ID (optional)"
            aria-label="Payment reference"
            className="w-full rounded-xl border border-border bg-white p-2 text-sm disabled:opacity-60"
          />
          <p className="text-xs text-muted">
            {recordingPayment
              ? "Saved in this order’s History. Marking it paid doesn’t touch stock."
              : "Saved in this order’s History. Recording it doesn’t change the order’s status or stock."}
          </p>
        </div>
      )}

      {returning && (
        <label className="flex items-start gap-2 rounded-xl border border-border bg-lavender/20 p-3 text-xs text-ink">
          <input
            type="checkbox"
            checked={restockReturned}
            onChange={(e) => setRestockReturned(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Add the returned items back to stock. Tick this only once the parcel is back and the items are fit to
            sell again — leave it unticked to keep them out of inventory.
          </span>
        </label>
      )}

      {refundingShippedOrder && (
        <p className="rounded-xl bg-lavender/30 p-3 text-xs text-muted">
          Refunding an order that has already shipped doesn&rsquo;t add anything back to stock. If the items are coming
          back, mark it Returned instead.
        </p>
      )}

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
          disabled={busy || (needsRefundAcknowledgement && !acknowledgeExternalRefund) || (recordingPayment && !paymentMethodChoice)}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      )}
    </div>
  );
}
