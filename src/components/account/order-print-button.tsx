"use client";

import { Printer } from "lucide-react";

/**
 * F-328: lets a shopper produce a clean, single-page receipt from an
 * order-confirmation page (currently the guest /order/[number] page —
 * src/app/order/[number]/page.tsx). window.print() alone is enough: the
 * site chrome (header/utility bar/footer/WhatsApp fab/drawers) is hidden
 * via the print:hidden utility in site-shell.tsx, and this button hides
 * itself the same way so it never appears on the printed page.
 */
export function OrderPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand print:hidden"
    >
      <Printer size={16} />
      Print receipt
    </button>
  );
}
