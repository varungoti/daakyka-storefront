import { formatDateTimeIST } from "@/lib/format/datetime";
import type { OrderHistoryEntry } from "@/lib/orders/admin-orders";

interface Props {
  /** ISO string — the order's `createdAt`, always rendered as the first
   * "Placed" event even when AuditLog has no rows yet (a brand-new order). */
  placedAt: string;
  entries: OrderHistoryEntry[];
}

/** F-199 fix: labels for admin-orders.ts's paymentRecordMethodValues; an
 * unrecognised value (a future method) falls back to its raw text. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  UPI: "UPI",
  BANK_TRANSFER: "bank transfer",
  CASH: "cash",
  COD: "cash on delivery",
  OTHER: "other method",
};

function describeEntry(entry: OrderHistoryEntry): string {
  const parts: string[] = [];
  if (entry.fromStatus && entry.toStatus) {
    parts.push(`Status changed: ${entry.fromStatus.replace("_", " ")} → ${entry.toStatus.replace("_", " ")}`);
    if (entry.trackingNumber || entry.courier) {
      parts.push(`(${entry.courier ?? "courier"} · ${entry.trackingNumber ?? "no tracking number"})`);
    }
    if (entry.restockedUnits) {
      parts.push(`— ${entry.restockedUnits} unit${entry.restockedUnits === 1 ? "" : "s"} restocked`);
    }
    if (entry.manualPaidTransition) {
      parts.push("(marked paid manually)");
    }
    if (entry.paymentRecorded) {
      const { method, reference } = entry.paymentRecorded;
      parts.push(`(payment received via ${PAYMENT_METHOD_LABELS[method] ?? method}${reference ? ` · ref ${reference}` : ""})`);
    }
  } else if (entry.trackingNumber || entry.courier) {
    parts.push(`Tracking updated: ${entry.courier ?? "—"} ${entry.trackingNumber ?? ""}`.trim());
  } else if (entry.adminNotesUpdated) {
    parts.push("Admin notes updated");
  } else {
    // Fallback for an audit action shape this timeline doesn't have a
    // friendlier label for yet — still shows *something* happened, rather
    // than a blank line.
    parts.push(entry.action === "update" ? "Order updated" : entry.action);
  }
  return parts.join(" ");
}

/**
 * F-205 fix: renders the order's AuditLog trail (see admin-orders.ts's
 * getOrderHistory) as a simple chronological timeline, Shopify-style —
 * who changed what, and when, in IST. `placedAt` is always the first row;
 * everything after it comes from AuditLog and may be empty for an order
 * with no admin edits yet (nothing to show beyond "Placed").
 */
export function OrderTimeline({ placedAt, entries }: Props) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 font-display text-lg font-bold text-ink">History</h2>
      <ol className="space-y-3 border-l border-border pl-4 text-sm">
        <li className="relative">
          <span className="absolute -left-[19px] top-1 h-2 w-2 rounded-full bg-muted" aria-hidden="true" />
          <p className="text-ink">Order placed</p>
          <p className="text-xs text-muted">{formatDateTimeIST(placedAt)}</p>
        </li>
        {entries.map((entry) => (
          <li key={entry.id} className="relative">
            <span className="absolute -left-[19px] top-1 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
            <p className="break-words text-ink">{describeEntry(entry)}</p>
            <p className="text-xs text-muted">
              {formatDateTimeIST(entry.createdAt)}
              {entry.actorName ? ` · ${entry.actorName}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
