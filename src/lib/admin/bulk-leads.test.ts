import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BULK_LEAD_STATUS_FILTERS,
  BULK_LEADS_PAGE_SIZE,
  parseBulkLeadStatusFilter,
  telHref,
  whatsappLink,
} from "@/lib/admin/bulk-leads";
import { adminListHref, getPageWindow } from "@/lib/admin/pagination";

// F-196: the Bulk Order Manager rendered every lead (45+, 13,000px tall on a
// phone) with no way to filter. These pin the pieces the paged, filterable
// list is built from.

describe("parseBulkLeadStatusFilter", () => {
  it("accepts each real BulkLeadStatus", () => {
    for (const status of ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"]) {
      assert.equal(parseBulkLeadStatusFilter(status), status);
    }
  });

  it("offers a chip for exactly the statuses BulkLeadStatusSelect and the PATCH route accept", () => {
    assert.deepEqual(
      BULK_LEAD_STATUS_FILTERS.map((filter) => filter.value),
      ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"],
    );
  });

  it("treats anything else as no filter instead of passing it into the query", () => {
    for (const raw of [undefined, "", "new", "Won", "ALL", "NEW,WON", "DROP TABLE", "constructor"]) {
      assert.equal(parseBulkLeadStatusFilter(raw), undefined, `status=${JSON.stringify(raw)}`);
    }
  });

  it("uses the first value of a repeated ?status=NEW&status=WON", () => {
    assert.equal(parseBulkLeadStatusFilter(["NEW", "WON"]), "NEW");
    assert.equal(parseBulkLeadStatusFilter(["bogus", "WON"]), undefined);
  });
});

describe("bulk leads paging", () => {
  it("45 leads at the page size is two pages, with the second starting at the right offset", () => {
    const first = getPageWindow(1, 45, BULK_LEADS_PAGE_SIZE);
    assert.equal(first.totalPages, 2);
    assert.equal(first.skip, 0);
    assert.equal(first.take, BULK_LEADS_PAGE_SIZE);

    const second = getPageWindow(2, 45, BULK_LEADS_PAGE_SIZE);
    assert.equal(second.skip, BULK_LEADS_PAGE_SIZE);
  });

  it("a status-filtered view pages over its own count, and the pager keeps the status in the link", () => {
    const window = getPageWindow(1, 60, BULK_LEADS_PAGE_SIZE);
    assert.equal(window.totalPages, 3);
    assert.equal(adminListHref("/admin/bulk-orders", { status: "NEW", page: 2 }), "/admin/bulk-orders?status=NEW&page=2");
    assert.equal(adminListHref("/admin/bulk-orders", { status: "NEW", page: 1 }), "/admin/bulk-orders?status=NEW");
    assert.equal(adminListHref("/admin/bulk-orders", { status: undefined, page: 1 }), "/admin/bulk-orders");
  });
});

describe("whatsappLink", () => {
  it("prefixes 91 onto a bare 10-digit Indian mobile", () => {
    assert.equal(whatsappLink("98765 43210"), "https://wa.me/919876543210");
  });

  it("keeps an already country-coded number as digits only", () => {
    assert.equal(whatsappLink("+91 98765-43210"), "https://wa.me/919876543210");
  });

  it("returns null rather than a dead link for a number that can't be right", () => {
    assert.equal(whatsappLink("12345"), null);
    assert.equal(whatsappLink("not a phone"), null);
    assert.equal(whatsappLink("1".repeat(16)), null);
  });
});

describe("telHref", () => {
  it("strips spacing and punctuation but keeps a leading +", () => {
    assert.equal(telHref("+91 (98765) 43-210"), "tel:+919876543210");
  });

  it("falls back to the raw text when nothing dialable is left", () => {
    assert.equal(telHref("ext. unknown"), "tel:ext. unknown");
  });
});
