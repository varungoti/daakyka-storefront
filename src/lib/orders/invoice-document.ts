import type { OrderStatus } from "@/generated/prisma/client";

/**
 * Pure (no database) decisions about the printed invoice page
 * (src/app/admin/(panel)/orders/[id]/invoice/page.tsx) — kept out of that
 * Server Component, and out of invoice-number.ts (which imports the
 * database), so every OrderStatus can be asserted in a plain unit test.
 */

// Matches PURCHASE_COUNTING_ORDER_STATUSES in src/lib/reviews/create-review.ts
// — the same "a real sale happened" definition. PENDING_PAYMENT never
// reaches an invoice number; CANCELLED/REFUNDED/RETURNED deliberately never
// get one (the printed document is a "not a tax invoice" / credit-note
// notice instead — see getInvoiceDocument).
const INVOICE_ELIGIBLE_STATUSES = new Set<OrderStatus>(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);

export function isInvoiceEligible(status: OrderStatus): boolean {
  return INVOICE_ELIGIBLE_STATUSES.has(status);
}

export interface InvoiceDocument {
  /** The title printed at the top right of the page. */
  heading: string;
  /** True for a cancelled/refunded/returned order: the page then shows
   * `notice` in a warning banner and omits the "Authorised Signatory"
   * block, since it is not a document anyone can use as a tax invoice. */
  voided: boolean;
  /** The warning banner text when `voided`; null otherwise. */
  notice: string | null;
}

export interface InvoiceDocumentContext {
  /** The GST serial already assigned to this order (`Order.invoiceNumber`),
   * if any — an order whose invoice was printed while it was still live
   * keeps its number for life. */
  invoiceNumber: string | null;
  /** Whether the order actually shipped (`Order.shippedAt`) — the point at
   * which the goods were supplied, so a later refund needs a credit note
   * against an invoice that was issued, rather than just voiding it. */
  shipped: boolean;
}

/**
 * F-195 / F-199: the printed document's title must say what it actually
 * is. A bare "Invoice" for an unpaid or cancelled order is misleading, and
 * (once a GSTIN is configured) only a genuinely invoice-eligible order
 * gets to say "Tax Invoice".
 *
 * F-199 made RETURNED reachable (and REFUNDED reachable after shipping),
 * so the page can no longer assume that a non-live order was simply
 * "cancelled":
 *  - CANCELLED never supplied any goods, so the document is just void;
 *  - REFUNDED / RETURNED are named for what happened to the order, never
 *    "Cancelled". A return is always after shipping; a refund is, when
 *    `shipped` says so. After supply, an invoice that was already issued
 *    (`invoiceNumber`) can't just be voided — the sale has to be reversed
 *    with a credit note, so the page says so instead of reusing the
 *    cancelled wording.
 * No order in one of these states ever gets a fresh invoice number
 * (isInvoiceEligible), so a numberless voided document stays numberless.
 */
export function getInvoiceDocument(
  status: OrderStatus,
  hasGstin: boolean,
  { invoiceNumber, shipped }: InvoiceDocumentContext,
): InvoiceDocument {
  if (status === "CANCELLED") {
    return {
      heading: "Cancelled — Not a Tax Invoice",
      voided: true,
      notice: "This order was cancelled. This document is not a valid tax invoice.",
    };
  }

  if (status === "REFUNDED" || status === "RETURNED") {
    const word = status === "REFUNDED" ? "Refunded" : "Returned";
    const past = status === "REFUNDED" ? "refunded" : "returned";
    const supplied = status === "RETURNED" || shipped;

    if (supplied && invoiceNumber) {
      return {
        heading: `${word} — Credit Note Required`,
        voided: true,
        notice: `Invoice No. ${invoiceNumber} was issued for this order, which was then ${past} after it shipped. Raise a credit note against that invoice — this copy is not a valid tax invoice.`,
      };
    }
    return {
      heading: `${word} — Not a Tax Invoice`,
      voided: true,
      notice: `This order was ${past}${supplied ? " after it shipped" : " before it shipped"}. This document is not a valid tax invoice.`,
    };
  }

  if (isInvoiceEligible(status)) {
    return { heading: hasGstin ? "Tax Invoice" : "Bill of Supply", voided: false, notice: null };
  }
  return { heading: "Proforma Invoice", voided: false, notice: null };
}
