import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrderStatus } from "@/generated/prisma/client";
import { getInvoiceDocument, isInvoiceEligible } from "@/lib/orders/invoice-document";

const ALL_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "RETURNED",
];

const unnumbered = { invoiceNumber: null, shipped: false };

describe("isInvoiceEligible (F-195)", () => {
  it("only an order that is, or went on to be, a real sale can be numbered", () => {
    for (const status of ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const) {
      assert.equal(isInvoiceEligible(status), true, status);
    }
    for (const status of ["PENDING_PAYMENT", "CANCELLED", "REFUNDED", "RETURNED"] as const) {
      assert.equal(isInvoiceEligible(status), false, status);
    }
  });
});

describe("getInvoiceDocument (F-195 / F-199)", () => {
  it("covers every OrderStatus without throwing", () => {
    for (const status of ALL_STATUSES) {
      const doc = getInvoiceDocument(status, true, unnumbered);
      assert.ok(doc.heading.length > 0, status);
    }
  });

  it("a live order is a Tax Invoice with a GSTIN, a Bill of Supply without one, and unpaid ones are Proforma", () => {
    for (const status of ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const) {
      assert.deepEqual(getInvoiceDocument(status, true, unnumbered), { heading: "Tax Invoice", voided: false, notice: null });
      assert.equal(getInvoiceDocument(status, false, unnumbered).heading, "Bill of Supply");
    }
    assert.deepEqual(getInvoiceDocument("PENDING_PAYMENT", true, unnumbered), {
      heading: "Proforma Invoice",
      voided: false,
      notice: null,
    });
  });

  it("a cancelled order never supplied anything: just void, whatever its invoice number", () => {
    for (const invoiceNumber of [null, "DK/2026-27/000001"]) {
      const doc = getInvoiceDocument("CANCELLED", true, { invoiceNumber, shipped: false });
      assert.equal(doc.heading, "Cancelled — Not a Tax Invoice");
      assert.equal(doc.voided, true);
      assert.match(doc.notice ?? "", /was cancelled/);
    }
  });

  it("F-199: a returned order is never printed as a Proforma Invoice or called cancelled", () => {
    const doc = getInvoiceDocument("RETURNED", true, unnumbered);
    assert.equal(doc.heading, "Returned — Not a Tax Invoice");
    assert.equal(doc.voided, true);
    assert.match(doc.notice ?? "", /returned after it shipped/);
    assert.doesNotMatch(`${doc.heading} ${doc.notice}`, /cancel|proforma/i);
  });

  it("F-199: a returned order that was already invoiced needs a credit note, and names the invoice", () => {
    const doc = getInvoiceDocument("RETURNED", true, { invoiceNumber: "DK/2026-27/000007", shipped: true });
    assert.equal(doc.heading, "Returned — Credit Note Required");
    assert.equal(doc.voided, true);
    assert.match(doc.notice ?? "", /DK\/2026-27\/000007/);
    assert.match(doc.notice ?? "", /credit note/i);
  });

  it("F-199: an order refunded after shipping is 'Refunded', not 'Cancelled' — with a credit note when it was invoiced", () => {
    const plain = getInvoiceDocument("REFUNDED", true, { invoiceNumber: null, shipped: true });
    assert.equal(plain.heading, "Refunded — Not a Tax Invoice");
    assert.match(plain.notice ?? "", /refunded after it shipped/);

    const invoiced = getInvoiceDocument("REFUNDED", true, { invoiceNumber: "DK/2026-27/000008", shipped: true });
    assert.equal(invoiced.heading, "Refunded — Credit Note Required");
    assert.match(invoiced.notice ?? "", /DK\/2026-27\/000008/);
    assert.match(invoiced.notice ?? "", /credit note/i);
    assert.doesNotMatch(`${plain.heading} ${plain.notice} ${invoiced.heading} ${invoiced.notice}`, /cancel/i);
  });

  it("F-199: an order refunded before it shipped supplied nothing — no credit note, even if it had been numbered", () => {
    const doc = getInvoiceDocument("REFUNDED", true, { invoiceNumber: "DK/2026-27/000009", shipped: false });
    assert.equal(doc.heading, "Refunded — Not a Tax Invoice");
    assert.match(doc.notice ?? "", /refunded before it shipped/);
    assert.doesNotMatch(doc.notice ?? "", /credit note/i);
  });
});
