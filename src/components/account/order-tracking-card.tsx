import { Truck } from "lucide-react";
import { CopyTrackingNumber } from "@/components/account/copy-tracking-number";
import { getCourierTrackingUrl } from "@/lib/orders/courier-tracking";

/**
 * Release-hardening item 2 — renders only when the order actually has a
 * tracking number (admins set trackingNumber/courier from
 * src/components/admin/order-detail-actions.tsx once an order ships).
 * Links out only for a courier getCourierTrackingUrl can confidently
 * resolve; every other courier's number renders as copyable text rather
 * than a guessed/broken link — see that module's doc comment for why.
 */
export function OrderTrackingCard({
  trackingNumber,
  courier,
}: {
  trackingNumber: string | null;
  courier: string | null;
}) {
  if (!trackingNumber) return null;
  const trackingUrl = getCourierTrackingUrl(courier, trackingNumber);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <Truck size={20} className="text-brand" aria-hidden /> Tracking
      </h2>
      <div className="space-y-3 text-sm">
        {courier && (
          <p>
            <span className="text-muted">Courier: </span>
            <span className="font-semibold text-ink">{courier}</span>
          </p>
        )}
        <div>
          <p className="mb-1 text-muted">Tracking number</p>
          {trackingUrl ? (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-brand hover:underline"
            >
              {trackingNumber} →
            </a>
          ) : (
            <CopyTrackingNumber value={trackingNumber} />
          )}
        </div>
      </div>
    </section>
  );
}
