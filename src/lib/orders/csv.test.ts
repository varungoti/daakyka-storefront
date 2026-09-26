import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrdersCsv, formatOrderCsvRows, formatOrderRowForCsv, ORDER_EXPORT_COLUMNS, type OrderCsvRow } from "@/lib/orders/csv";

function sampleRow(overrides: Partial<OrderCsvRow> = {}): OrderCsvRow {
  return {
    number: "DK-2026-000123",
    email: "customer@example.com",
    // normalizeIndianPhone (src/lib/validation/india.ts) always stores a
    // plain 10-digit string, never a "+"-prefixed one — matching that here
    // so this fixture doesn't accidentally exercise the formula-escaping
    // path (covered on its own further down) by coincidence.
    phone: "9000000000",
    customerName: "Asha Rao",
    status: "PAID",
    paymentMethod: "RAZORPAY",
    itemCount: 2,
    itemsSummary: "DK-SKU-1 x2",
    subtotal: 1200,
    shipping: 99,
    discount: 0,
    discountCode: null,
    total: 1299,
    currency: "INR",
    trackingNumber: null,
    courier: null,
    shipName: "Asha Rao",
    shipAddressLine1: "12 MG Road",
    shipAddressLine2: null,
    shipCity: "Hyderabad",
    shipState: "Telangana",
    shipPincode: "500001",
    shipCountry: "IN",
    // 2026-01-15T10:30:00Z is 16:00 IST.
    createdAt: new Date("2026-01-15T10:30:00.000Z"),
    ...overrides,
  };
}

describe("order CSV row formatting (Phase D4 / F-204)", () => {
  it("formats a row in column order", () => {
    const row = formatOrderRowForCsv(sampleRow());
    assert.equal(row.length, ORDER_EXPORT_COLUMNS.length);
    assert.deepEqual(row, [
      "DK-2026-000123",
      "customer@example.com",
      "9000000000",
      "Asha Rao",
      "PAID",
      "RAZORPAY",
      2,
      "DK-SKU-1 x2",
      1200,
      99,
      0,
      "",
      1299,
      "INR",
      "",
      "",
      "Asha Rao",
      "12 MG Road",
      "",
      "Hyderabad",
      "Telangana",
      "500001",
      "IN",
      "2026-01-15 16:00:00+05:30",
    ]);
  });

  it("renders null phone/name/tracking/courier/address as empty strings, not the literal 'null'", () => {
    const row = formatOrderRowForCsv(
      sampleRow({
        phone: null,
        customerName: null,
        trackingNumber: null,
        courier: null,
        discountCode: null,
        shipName: null,
        shipAddressLine1: null,
        shipAddressLine2: null,
        shipCity: null,
        shipState: null,
        shipPincode: null,
        shipCountry: null,
      }),
    );
    for (const index of [2, 3, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
      assert.equal(row[index], "", `column ${index} should be an empty string`);
    }
  });

  it("includes tracking number, courier and discount code when present", () => {
    const row = formatOrderRowForCsv(
      sampleRow({ status: "SHIPPED", trackingNumber: "TRK123", courier: "Bluedart", discountCode: "HERO10" }),
    );
    assert.equal(row[14], "TRK123");
    assert.equal(row[15], "Bluedart");
    assert.equal(row[11], "HERO10");
  });

  it("formats created_at in IST, not UTC", () => {
    // 2026-09-25T20:00:00Z is 01:30 IST on the 26th — a UTC-formatted
    // column would (wrongly) show the 25th.
    const row = formatOrderRowForCsv(sampleRow({ createdAt: new Date("2026-09-25T20:00:00.000Z") }));
    assert.equal(row[row.length - 1], "2026-09-26 01:30:00+05:30");
  });

  describe("formula-injection escaping (F-204)", () => {
    for (const dangerous of ["=1+1", "+1+1", "-2+3@example.com", "@SUM(A1:A2)", "\tcmd"]) {
      it(`prefixes a cell starting with ${JSON.stringify(dangerous[0])} with an apostrophe`, () => {
        const row = formatOrderRowForCsv(sampleRow({ email: dangerous }));
        assert.equal(row[1], `'${dangerous}`);
      });
    }

    it("does not touch a normal cell that merely contains one of those characters", () => {
      const row = formatOrderRowForCsv(sampleRow({ shipAddressLine1: "12-B MG Road" }));
      assert.equal(row[17], "12-B MG Road");
    });

    it("never prefixes a numeric column, even when the amount is negative", () => {
      const row = formatOrderRowForCsv(sampleRow({ discount: -50 }));
      assert.equal(row[10], -50);
      assert.equal(typeof row[10], "number");
    });

    it("escapes a formula-like courier or tracking number an admin typed in", () => {
      const row = formatOrderRowForCsv(sampleRow({ courier: "=HYPERLINK(\"http://evil\")" }));
      assert.equal(row[15], "'=HYPERLINK(\"http://evil\")");
    });
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

  describe("formatOrderCsvRows (F-342 streaming)", () => {
    it("returns an empty string for an empty batch, never a bare newline", () => {
      assert.equal(formatOrderCsvRows([]), "");
    });

    it("formats a batch with no header row, matching buildOrdersCsv's data rows", () => {
      const orders = [sampleRow(), sampleRow({ number: "DK-2026-000124" })];
      const batch = formatOrderCsvRows(orders);
      const fullCsv = buildOrdersCsv(orders);
      assert.equal(batch, fullCsv.split("\n").slice(1).join("\n"));
    });
  });
});
