import { db } from "@/lib/db";
import type { OrderStatus } from "@/generated/prisma/client";

/**
 * release-hardening F-195: a real, sequential GST invoice number
 * (`Order.invoiceNumber`, added in wave 1 — see prisma/schema.prisma), kept
 * separate from the customer-facing, non-sequential `Order.number`.
 *
 * Design decision: the wave-1 schema addition deliberately didn't add a
 * per-financial-year counter table (that would need a schema migration
 * this package isn't allowed to make — see prisma/schema.prisma's own
 * comment on `invoiceNumber`). Instead, the next sequence number for a
 * financial year is derived from how many orders already have an
 * `invoiceNumber` starting with that year's prefix, computed and written
 * inside one transaction guarded by a Postgres advisory lock keyed to the
 * financial year — so two admins opening two different orders' invoices at
 * the same moment can't race to the same number. A dedicated counter table
 * (immune to a gap if a transaction ever rolled back) is the more robust
 * long-term fix; flagged as a follow-up rather than attempted here.
 *
 * Numbers are assigned lazily, the first time an invoice is actually
 * *viewed* for an order that has reached a real "this was sold" status —
 * not at PAID-transition time in the checkout/webhook code path, which
 * this package doesn't own and shouldn't be touching for a GST-numbering
 * concern. Assigning it here means an order that's viewed for the first
 * time already fulfilled/shipped/delivered gets a number too, and no
 * number is ever "used up" by an order that's merely pending payment or
 * that gets cancelled before anyone ever prints an invoice for it.
 */

// Matches PURCHASE_COUNTING_ORDER_STATUSES in src/lib/reviews/create-review.ts
// — the same "a real sale happened" definition. PENDING_PAYMENT never
// reaches here; CANCELLED/REFUNDED deliberately never get a number (the
// printed document is a "not a tax invoice" notice instead — see the
// invoice page).
const INVOICE_ELIGIBLE_STATUSES = new Set<OrderStatus>(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);

export function isInvoiceEligible(status: OrderStatus): boolean {
  return INVOICE_ELIGIBLE_STATUSES.has(status);
}

/** "2026-27" for any date between 1 Apr 2026 and 31 Mar 2027 (India's
 * financial year), the format GST invoice numbers conventionally use. */
export function financialYearLabel(date: Date): string {
  const month = date.getMonth(); // 0-indexed; 3 = April
  const startYear = month >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const INVOICE_PREFIX = "DK";

function invoicePrefixFor(fy: string): string {
  return `${INVOICE_PREFIX}/${fy}/`;
}

/**
 * Returns the order's existing invoice number, or assigns and returns a new
 * one if the order has reached an invoice-eligible status and doesn't have
 * one yet. Returns null for an order that hasn't reached one of those
 * statuses (a PENDING_PAYMENT/ORDER_REQUEST-not-yet-paid, CANCELLED, or
 * REFUNDED order) — the invoice page renders those as a proforma/cancelled
 * notice instead of a numbered tax document.
 */
export async function ensureInvoiceNumber(orderId: string): Promise<string | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, invoiceNumber: true, createdAt: true },
  });
  if (!order) return null;
  if (order.invoiceNumber) return order.invoiceNumber;
  if (!isInvoiceEligible(order.status)) return null;

  const fy = financialYearLabel(new Date());
  const prefix = invoicePrefixFor(fy);

  return db.$transaction(async (tx) => {
    // Advisory locks are transaction-scoped (pg_advisory_xact_lock) and
    // released automatically at commit/rollback — serializes every
    // invoice-number assignment for the same financial year, across
    // whichever admin session gets there first, without a dedicated lock
    // row. hashtext() collapses the FY string to the bigint key the
    // function needs.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;

    // Re-read inside the lock: another transaction may have assigned this
    // exact order a number (or bumped the count) between the check above
    // and acquiring the lock.
    const current = await tx.order.findUnique({ where: { id: orderId }, select: { invoiceNumber: true } });
    if (current?.invoiceNumber) return current.invoiceNumber;

    const { _count } = await tx.order.aggregate({
      _count: { _all: true },
      where: { invoiceNumber: { startsWith: prefix } },
    });
    const sequence = _count._all + 1;
    const invoiceNumber = `${prefix}${String(sequence).padStart(6, "0")}`;

    await tx.order.update({ where: { id: orderId }, data: { invoiceNumber } });
    return invoiceNumber;
  });
}
