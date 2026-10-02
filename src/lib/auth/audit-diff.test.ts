import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@/generated/prisma/client";
import { changedContentKeys, changedFieldNames, diffFields, normaliseAuditValue } from "@/lib/auth/audit-diff";

/**
 * F-288: the before -> after helpers behind every audit row that used to say
 * "updated" and nothing else. Pure, no DB.
 */

describe("normaliseAuditValue", () => {
  it("turns a Prisma Decimal into a number, a Date into an ISO string, and undefined into null", () => {
    assert.equal(normaliseAuditValue(new Prisma.Decimal("499.50")), 499.5);
    assert.equal(normaliseAuditValue(new Date("2026-01-02T03:04:05.000Z")), "2026-01-02T03:04:05.000Z");
    assert.equal(normaliseAuditValue(undefined), null);
    assert.deepEqual(normaliseAuditValue([new Prisma.Decimal(1), "a"]), [1, "a"]);
  });
});

describe("diffFields", () => {
  it("lists only the fields that actually changed, as { from, to }", () => {
    const before = { name: "Scrub", price: new Prisma.Decimal(500), status: "DRAFT", featured: false };
    const after = { name: "Scrub", price: new Prisma.Decimal(1), status: "ACTIVE", featured: false };
    assert.deepEqual(diffFields(before, after, ["name", "price", "status", "featured"]), {
      price: { from: 500, to: 1 },
      status: { from: "DRAFT", to: "ACTIVE" },
    });
  });

  it("treats a Decimal and the equal number as unchanged (a re-save of the same price)", () => {
    assert.deepEqual(diffFields({ price: new Prisma.Decimal("500.00") }, { price: 500 }, ["price"]), {});
  });

  it("compares dates by instant and arrays by content", () => {
    const d1 = new Date("2026-05-01T00:00:00Z");
    assert.deepEqual(diffFields({ at: d1, tags: ["a", "b"] }, { at: new Date(d1), tags: ["a", "b"] }, ["at", "tags"]), {});
    assert.deepEqual(diffFields({ tags: ["a"] }, { tags: ["a", "b"] }, ["tags"]), { tags: { from: ["a"], to: ["a", "b"] } });
  });

  it("records a cleared field as to: null and a newly-set one as from: null", () => {
    assert.deepEqual(diffFields({ compareAtPrice: 900 }, { compareAtPrice: null }, ["compareAtPrice"]), {
      compareAtPrice: { from: 900, to: null },
    });
    assert.deepEqual(diffFields({ maxRedemptions: null }, { maxRedemptions: 50 }, ["maxRedemptions"]), {
      maxRedemptions: { from: null, to: 50 },
    });
  });

  it("clips a very long string instead of copying it into the audit row, but still notices it changed", () => {
    const long = "x".repeat(500);
    const changes = diffFields({ note: long }, { note: `${long}y` }, ["note"]);
    assert.ok(changes.note);
    assert.ok(String(changes.note.to).length <= 201);
    assert.ok(String(changes.note.to).endsWith("…"));
  });

  it("ignores keys that are not in the list", () => {
    assert.deepEqual(diffFields({ a: 1, b: 1 }, { a: 2, b: 2 }, ["a"]), { a: { from: 1, to: 2 } });
  });
});

describe("changedFieldNames", () => {
  it("names the changed fields without copying their contents", () => {
    assert.deepEqual(changedFieldNames({ description: "<p>old</p>", name: "x" }, { description: "<p>new</p>", name: "x" }, ["description", "name"]), [
      "description",
    ]);
  });
});

describe("changedContentKeys", () => {
  it("lists the top-level keys of a JSON content blob that changed", () => {
    const before = JSON.stringify({ heading: "Old", slides: [1, 2], cta: "Shop" });
    assert.deepEqual(changedContentKeys(before, { heading: "New", slides: [1, 2], cta: "Shop" }), ["heading"]);
    assert.deepEqual(changedContentKeys(before, { heading: "Old", slides: [1, 2, 3], cta: "Shop", extra: true }), ["extra", "slides"]);
  });

  it("returns an empty list for an unchanged save", () => {
    const before = JSON.stringify({ heading: "Same" });
    assert.deepEqual(changedContentKeys(before, { heading: "Same" }), []);
  });

  it("falls back to a single (content) entry when either side is not a JSON object", () => {
    assert.deepEqual(changedContentKeys(null, { a: 1 }), ["(content)"]);
    assert.deepEqual(changedContentKeys("not json", [1, 2]), ["(content)"]);
    assert.deepEqual(changedContentKeys(JSON.stringify([1, 2]), [1, 2]), []);
  });
});
