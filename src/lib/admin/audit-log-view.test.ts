import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_ENTITY_LABELS,
  auditActionLabel,
  auditEntityHref,
  auditEntityLabel,
  buildAuditWhere,
  canViewAuditDetails,
  formatAuditMetadata,
  formatAuditMetadataForRole,
  parseAuditFilters,
  shortenAuditId,
} from "@/lib/admin/audit-log-view";
import { adminRoles, hasPermission } from "@/lib/auth/rbac";

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

// F-167 review follow-up: audit:view is held by VIEWER and SEO_MANAGER, who
// can open none of the audited records — but the metadata beside a row is
// the record's own data (discount code, a customer email typed into the
// order-export search, a tracking number, an invited admin's email). The
// Details disclosure must only go to a role that could open the record.
describe("canViewAuditDetails / formatAuditMetadataForRole", () => {
  const SENSITIVE_ROWS: Array<[string, string]> = [
    ["discount", '{"code":"VIP100","type":"PERCENT","value":100}'],
    ["order", '{"filters":{"search":"priya@example.com"}}'],
    ["order", '{"trackingNumber":"AWB123456","paymentRecorded":{"reference":"UTR998877"}}'],
    ["newsletter_subscriber", '{"status":"all","query":"priya@example.com","count":3}'],
    ["user", '{"email":"new.admin@example.com","role":"ORDER_MANAGER"}'],
  ];

  it("never shows VIEWER or SEO_MANAGER the details of a discount, order, newsletter or user row", () => {
    for (const role of ["VIEWER", "SEO_MANAGER"] as const) {
      // They really do hold audit:view — the gap this guards.
      assert.equal(hasPermission(role, "audit:view"), true);
      for (const [entity, raw] of SENSITIVE_ROWS) {
        assert.equal(canViewAuditDetails(role, entity), false, `${role} / ${entity}`);
        assert.equal(formatAuditMetadataForRole(role, entity, raw), null, `${role} / ${entity}`);
      }
    }
  });

  it("shows the details to a role that holds the record's own permission", () => {
    const discount = formatAuditMetadataForRole("MARKETING_ADMIN", "discount", SENSITIVE_ROWS[0][1]);
    assert.ok(discount?.includes("VIP100"));
    const order = formatAuditMetadataForRole("STORE_OWNER", "order", SENSITIVE_ROWS[1][1]);
    assert.ok(order?.includes("priya@example.com"));
    const invite = formatAuditMetadataForRole("SUPER_ADMIN", "user", SENSITIVE_ROWS[4][1]);
    assert.ok(invite?.includes("new.admin@example.com"));
  });

  it("keeps admin-user details to the role that manages users", () => {
    assert.equal(canViewAuditDetails("SUPER_ADMIN", "user"), true);
    assert.equal(canViewAuditDetails("STORE_OWNER", "user"), false);
    assert.equal(canViewAuditDetails("MARKETING_ADMIN", "user"), false);
  });

  it("lets a read-only catalogue role see product and media changes, which are public data", () => {
    assert.equal(canViewAuditDetails("SEO_MANAGER", "product"), true);
    assert.equal(canViewAuditDetails("SEO_MANAGER", "media_asset"), true);
    assert.equal(canViewAuditDetails("VIEWER", "product"), false);
  });

  it("is never more permissive than the record's own admin page", () => {
    // Whenever a role gets a link to a record's page it also gets its details.
    for (const role of adminRoles) {
      for (const entity of Object.keys(AUDIT_ENTITY_LABELS)) {
        if (auditEntityHref(role, entity, "abc123")) {
          assert.equal(canViewAuditDetails(role, entity), true, `${role} / ${entity}`);
        }
      }
    }
  });

  it("fails closed for an entity it has no rule for, even for SUPER_ADMIN", () => {
    assert.equal(canViewAuditDetails("SUPER_ADMIN", "mystery"), false);
    assert.equal(canViewAuditDetails("SUPER_ADMIN", "constructor"), false);
    assert.equal(formatAuditMetadataForRole("SUPER_ADMIN", "mystery", '{"a":1}'), null);
  });

  it("covers every labelled entity, so SUPER_ADMIN never silently loses a Details view", () => {
    for (const entity of Object.keys(AUDIT_ENTITY_LABELS)) {
      assert.equal(canViewAuditDetails("SUPER_ADMIN", entity), true, entity);
    }
  });
});
