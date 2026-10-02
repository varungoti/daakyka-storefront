import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { buildAuditWhere, parseAuditFilters } from "@/lib/admin/audit-log-view";
import { getPageWindow } from "@/lib/admin/pagination";
import { findAnyAdminId } from "../helpers/admin-user";

/**
 * F-167: /admin/audit-logs filters (record type, action, actor, IST date
 * range) and pages through the table. The where-clause builder is pure and
 * unit-tested (src/lib/admin/audit-log-view.test.ts); this runs it against
 * real rows to prove the filters select what they claim, including the
 * IST day boundaries and the paging window over the filtered total.
 *
 * Run ONLY against the isolated per-package test DB (see the fix-kit's
 * testdb.mjs), never the default DATABASE_URL.
 */

describe("audit log filters against the database (F-167)", () => {
  const unique = randomUUID().slice(0, 8);
  const entity = `filter_test_${unique}`;
  const otherEntity = `filter_other_${unique}`;
  let adminId: string;
  const createdIds: string[] = [];

  async function addRow(data: { entity: string; action: string; createdAt: string; userId?: string }) {
    const row = await db.auditLog.create({
      data: {
        entity: data.entity,
        action: data.action,
        userId: data.userId,
        createdAt: new Date(data.createdAt),
        metadata: JSON.stringify({ note: "audit filter test" }),
      },
    });
    createdIds.push(row.id);
    return row;
  }

  before(async () => {
    adminId = await findAnyAdminId();
    // Instants chosen around IST midnight: 10 Sept 00:00 IST == 9 Sept 18:30 UTC.
    await addRow({ entity, action: "create", createdAt: "2026-09-09T18:29:59.000Z", userId: adminId }); // 9 Sept 23:59:59 IST
    await addRow({ entity, action: "update", createdAt: "2026-09-09T18:30:00.000Z", userId: adminId }); // 10 Sept 00:00:00 IST
    await addRow({ entity, action: "update", createdAt: "2026-09-10T18:29:59.000Z" }); // 10 Sept 23:59:59 IST, no actor
    await addRow({ entity, action: "delete", createdAt: "2026-09-10T18:30:00.000Z", userId: adminId }); // 11 Sept 00:00:00 IST
    await addRow({ entity: otherEntity, action: "update", createdAt: "2026-09-10T06:00:00.000Z", userId: adminId });
  });

  after(async () => {
    await db.auditLog.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  const count = (params: Record<string, string>) =>
    db.auditLog.count({ where: buildAuditWhere(parseAuditFilters({ entity, ...params })) });

  it("filters by record type", async () => {
    assert.equal(await count({}), 4);
    assert.equal(await db.auditLog.count({ where: buildAuditWhere(parseAuditFilters({ entity: otherEntity })) }), 1);
  });

  it("filters by action", async () => {
    assert.equal(await count({ action: "update" }), 2);
    assert.equal(await count({ action: "delete" }), 1);
  });

  it("filters by actor", async () => {
    assert.equal(await count({ user: adminId }), 3);
  });

  it("reads the date range as whole IST days: 'from' starts at IST midnight, 'to' includes its entire day", async () => {
    // 10 Sept IST only: the 00:00:00 and 23:59:59 IST rows, not the 23:59:59 IST
    // the day before or the 00:00:00 IST the day after.
    assert.equal(await count({ from: "2026-09-10", to: "2026-09-10" }), 2);
    assert.equal(await count({ from: "2026-09-10" }), 3);
    assert.equal(await count({ to: "2026-09-09" }), 1);
    assert.equal(await count({ from: "2026-09-09", to: "2026-09-11" }), 4);
  });

  it("combines filters", async () => {
    assert.equal(await count({ action: "update", from: "2026-09-10", to: "2026-09-10" }), 2);
    assert.equal(await count({ action: "update", user: adminId, from: "2026-09-10", to: "2026-09-10" }), 1);
  });

  it("pages over the filtered total, newest first, with no overlap between pages", async () => {
    const where = buildAuditWhere(parseAuditFilters({ entity }));
    const total = await db.auditLog.count({ where });
    const first = getPageWindow(1, total, 3);
    const second = getPageWindow(2, total, 3);
    assert.equal(first.totalPages, 2);

    const page = (window: { skip: number; take: number }) =>
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: window.skip,
        take: window.take,
      });
    const [pageOne, pageTwo] = [await page(first), await page(second)];

    assert.equal(pageOne.length, 3);
    assert.equal(pageTwo.length, 1);
    const ids = new Set([...pageOne, ...pageTwo].map((row) => row.id));
    assert.equal(ids.size, 4, "no row repeated across pages");
    assert.equal(pageOne[0].action, "delete", "newest first");
    assert.equal(pageTwo[0].action, "create", "oldest last");
  });
});
