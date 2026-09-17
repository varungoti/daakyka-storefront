import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrdersCsv, formatOrderRowForCsv, ORDER_EXPORT_COLUMNS, type OrderCsvRow } from "@/lib/orders/csv";

function sampleRow(overrides: Partial<OrderCsvRow> = {}): OrderCsvRow {
  return {
    number: "DK-2026-000123",
    email: "customer@example.com",
    phone: "+91 90000 00000",
    status: "PAID",
    paymentMethod: "RAZORPAY",
    itemCount: 2,
    subtotal: 1200,
    shipping: 99,
    discount: 0,
    total: 1299,
    currency: "INR",
    trackingNumber: null,
    courier: null,
    createdAt: new Date("2026-01-15T10:30:00.000Z"),
    ...overrides,
  };
}

describe("order CSV row formatting (Phase D4)", () => {
  it("formats a row in column order", () => {
    const row = formatOrderRowForCsv(sampleRow());
    assert.equal(row.length, ORDER_EXPORT_COLUMNS.length);
    assert.deepEqual(row, [
      "DK-2026-000123",
      "customer@example.com",
      "+91 90000 00000",
      "PAID",
      "RAZORPAY",
      2,
      1200,
      99,
      0,
      1299,
      "INR",
      "",
      "",
      "2026-01-15T10:30:00.000Z",
    ]);
  });

  it("renders null phone/tracking/courier as empty strings, not the literal 'null'", () => {
    const row = formatOrderRowForCsv(sampleRow({ phone: null, trackingNumber: null, courier: null }));
    assert.equal(row[2], "");
    assert.equal(row[11], "");
    assert.equal(row[12], "");
  });

  it("includes tracking number and courier when present", () => {
    const row = formatOrderRowForCsv(
      sampleRow({ status: "SHIPPED", trackingNumber: "TRK123", courier: "Bluedart" }),
    );
    assert.equal(row[11], "TRK123");
    assert.equal(row[12], "Bluedart");
  });

  it("builds a full CSV with a header row and one line per order", () => {
    const csv = buildOrdersCsv([sampleRow(), sampleRow({ number: "DK-2026-000124", itemCount: 1 })]);
    const lines = csv.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], ORDER_EXPORT_COLUMNS.join(","));
    assert.match(lines[1], /^DK-2026-000123,/);
    assert.match(lines[2], /^DK-2026-000124,/);
  });

  it("produces an empty-but-headered CSV for zero orders", () => {
    const csv = buildOrdersCsv([]);
    assert.equal(csv, ORDER_EXPORT_COLUMNS.join(","));
  });

  it("quotes an email containing a comma (defensive; emails shouldn't have one, but CSV correctness shouldn't depend on that)", () => {
    const row = formatOrderRowForCsv(sampleRow({ email: "weird,email@example.com" }));
    const csv = buildOrdersCsv([sampleRow({ email: row[1] as string })]);
    assert.match(csv, /"weird,email@example\.com"/);
  });
});
