import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auditActionLabel,
  auditEntityHref,
  auditEntityLabel,
  buildAuditWhere,
  formatAuditMetadata,
  parseAuditFilters,
  shortenAuditId,
} from "@/lib/admin/audit-log-view";

// F-167: /admin/audit-logs showed the last 100 raw rows — no filters, no
// paging, `site_setting · shipping.flatRate` as the only description of a
// change, and the recorded "what changed" metadata never rendered.

describe("parseAuditFilters", () => {
  it("reads every filter and the page", () => {
    const filters = parseAuditFilters({
      entity: "site_setting",
      action: "update",
      user: "cmuser0000000000000000001",
      from: "2026-09-01",
      to: "2026-09-30",
      page: "4",
    });
    assert.deepEqual(filters, {
      entity: "site_setting",
      action: "update",
      userId: "cmuser0000000000000000001",
      from: "2026-09-01",
      to: "2026-09-30",
      page: 4,
    });
  });

  it("drops junk instead of passing it to the query", () => {
    const filters = parseAuditFilters({
      entity: "Robert'); DROP TABLE",
      action: "x".repeat(200),
      user: "has spaces",
      from: "yesterday",
      to: "2026-02-31",
      page: "-1",
    });
    assert.deepEqual(filters, {
      entity: undefined,
      action: undefined,
      userId: undefined,
      from: undefined,
      to: undefined,
      page: 1,
    });
  });
});

describe("buildAuditWhere", () => {
  it("is empty with no filters", () => {
    assert.deepEqual(buildAuditWhere({ page: 1 }), {});
  });

  it("filters by entity, action and user", () => {
    assert.deepEqual(buildAuditWhere({ page: 1, entity: "order", action: "update_status", userId: "u1" }), {
      entity: "order",
      action: "update_status",
      userId: "u1",
    });
  });

  it("reads the date range as IST days with the 'to' day included in full", () => {
    const where = buildAuditWhere({ page: 1, from: "2026-09-10", to: "2026-09-12" });
    const range = where.createdAt as { gte: Date; lt: Date };
    // 10 Sept 00:00 IST is 9 Sept 18:30 UTC; the range ends at the start of 13 Sept IST.
    assert.equal(range.gte.toISOString(), "2026-09-09T18:30:00.000Z");
    assert.equal(range.lt.toISOString(), "2026-09-12T18:30:00.000Z");
  });

  it("supports an open-ended range", () => {
    assert.deepEqual(Object.keys(buildAuditWhere({ page: 1, from: "2026-09-10" }).createdAt as object), ["gte"]);
    assert.deepEqual(Object.keys(buildAuditWhere({ page: 1, to: "2026-09-10" }).createdAt as object), ["lt"]);
  });
});

describe("labels", () => {
  it("turns raw entity and action keys into readable text", () => {
    assert.equal(auditEntityLabel("site_setting"), "Site setting");
    assert.equal(auditEntityLabel("seo_page_record"), "SEO override");
    assert.equal(auditActionLabel("update_status"), "Update status");
    assert.equal(auditActionLabel("login_locked"), "Login locked");
  });

  it("still renders an entity it has never heard of", () => {
    assert.equal(auditEntityLabel("shiny_new_thing"), "Shiny new thing");
  });

  it("does not treat Object.prototype names as known entities", () => {
    assert.equal(auditEntityLabel("constructor"), "Constructor");
  });

  it("shortens a cuid but leaves a readable key whole", () => {
    assert.equal(shortenAuditId("cmugq38i800bkh4oh22riqoxn"), "#riqoxn");
    assert.equal(shortenAuditId("shipping.flatRate"), "shipping.flatRate");
    assert.equal(shortenAuditId("razorpay:KEY_ID"), "razorpay:KEY_ID");
  });
});

describe("auditEntityHref", () => {
  it("links a record to its admin page for a role that can open it", () => {
    assert.equal(auditEntityHref("SUPER_ADMIN", "product", "cmugq38i800bkh4oh22riqoxn"), "/admin/products/cmugq38i800bkh4oh22riqoxn");
    assert.equal(auditEntityHref("ORDER_MANAGER", "order", "ord123"), "/admin/orders/ord123");
    assert.equal(auditEntityHref("SUPER_ADMIN", "site_setting", "shipping.flatRate"), "/admin/site-controls");
  });

  it("gives a role no link to a page it would be bounced from", () => {
    // VIEWER holds audit:view but none of these pages' permissions.
    assert.equal(auditEntityHref("VIEWER", "product", "cmugq38i800bkh4oh22riqoxn"), null);
    assert.equal(auditEntityHref("VIEWER", "order", "ord123"), null);
    assert.equal(auditEntityHref("SEO_MANAGER", "product", "cmugq38i800bkh4oh22riqoxn"), null);
    assert.equal(auditEntityHref("SEO_MANAGER", "seo_page_record", "seo123"), "/admin/seo/seo123");
  });

  it("returns null for an unknown entity, a missing id, or an id that isn't id-shaped", () => {
    assert.equal(auditEntityHref("SUPER_ADMIN", "mystery", "abc"), null);
    assert.equal(auditEntityHref("SUPER_ADMIN", "product", null), null);
    assert.equal(auditEntityHref("SUPER_ADMIN", "product", "../../etc"), null);
    assert.equal(auditEntityHref("SUPER_ADMIN", "constructor", "abc"), null);
  });
});

describe("formatAuditMetadata", () => {
  it("pretty-prints what changed", () => {
    assert.equal(formatAuditMetadata('{"value":99}'), '{\n  "value": 99\n}');
  });

  it("shows nothing for an empty, null or malformed value", () => {
    assert.equal(formatAuditMetadata(null), null);
    assert.equal(formatAuditMetadata(""), null);
    assert.equal(formatAuditMetadata("{}"), null);
    assert.equal(formatAuditMetadata("null"), null);
    assert.equal(formatAuditMetadata("{not json"), null);
  });

  it("masks a string under a credential-looking key, at any depth", () => {
    const out = formatAuditMetadata('{"role":"VIEWER","passwordHash":"abc","nested":{"apiKey":"k","token":"t"}}');
    assert.ok(out);
    assert.ok(out.includes('"role": "VIEWER"'));
    assert.ok(!out.includes('"abc"'));
    assert.ok(!out.includes('"k"'));
    assert.ok(!out.includes('"t"'));
    assert.equal((out.match(/\[redacted\]/g) ?? []).length, 3);
  });

  it("keeps a boolean flag like passwordReset: true — it can't carry a secret", () => {
    const out = formatAuditMetadata('{"passwordReset":true}');
    assert.ok(out?.includes('"passwordReset": true'));
  });

  it("bounds a huge value", () => {
    const out = formatAuditMetadata(JSON.stringify({ markdown: "x".repeat(20_000) }));
    assert.ok(out);
    assert.ok(out.length < 4100);
    assert.ok(out.endsWith("…"));
  });
});
