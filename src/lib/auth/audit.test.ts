import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/auth/audit";
import { findAnyAdminId } from "../../../tests/helpers/admin-user";

/**
 * F-289 fix (release-hardening schema-foundation): logAuditEvent now
 * records actorRole/actorEmail/ipAddress/userAgent alongside the existing
 * fields, filled in best-effort from the current Next.js request scope
 * when the caller doesn't pass them explicitly (see the module's doc
 * comment). Run directly via `tsx --test` — outside any real request —
 * `headers()`/`getSession()` resolve to "no request scope", which must
 * degrade to "no context available", never a thrown error.
 */

const createdLogIds: string[] = [];

after(async () => {
  if (createdLogIds.length > 0) {
    await db.auditLog.deleteMany({ where: { id: { in: createdLogIds } } }).catch(() => {});
  }
});

describe("logAuditEvent context capture (F-289)", () => {
  it("writes a row with no context fields — never throws — outside a request scope", async () => {
    const adminId = await findAnyAdminId();

    await logAuditEvent({
      userId: adminId,
      action: "test_action",
      entity: "test_entity",
      entityId: "entity-1",
      metadata: { note: "no context" },
    });

    const row = await db.auditLog.findFirst({
      where: { userId: adminId, action: "test_action", entity: "test_entity", entityId: "entity-1" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row, "expected an AuditLog row to have been written");
    createdLogIds.push(row!.id);

    // Outside a request scope, headers()/getSession() resolve to nothing —
    // the row is still written, just without these fields.
    assert.equal(row!.actorEmail, null);
    assert.equal(row!.actorRole, null);
    assert.equal(row!.ipAddress, null);
    assert.equal(row!.userAgent, null);
    assert.deepEqual(JSON.parse(row!.metadata!), { note: "no context" });
  });

  it("persists an explicit context verbatim instead of the best-effort lookup", async () => {
    const adminId = await findAnyAdminId();

    await logAuditEvent({
      userId: adminId,
      action: "test_action_with_context",
      entity: "test_entity",
      context: {
        actorEmail: "actor@example.com",
        actorRole: "SUPER_ADMIN",
        ip: "203.0.113.9",
        userAgent: "TestAgent/1.0",
      },
    });

    const row = await db.auditLog.findFirst({
      where: { userId: adminId, action: "test_action_with_context" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row);
    createdLogIds.push(row!.id);

    assert.equal(row!.actorEmail, "actor@example.com");
    assert.equal(row!.actorRole, "SUPER_ADMIN");
    assert.equal(row!.ipAddress, "203.0.113.9");
    assert.equal(row!.userAgent, "TestAgent/1.0");
  });

  it("truncates an oversized user-agent instead of storing it unbounded", async () => {
    const adminId = await findAnyAdminId();
    const hugeUserAgent = "A".repeat(2000);

    await logAuditEvent({
      userId: adminId,
      action: "test_action_long_ua",
      entity: "test_entity",
      context: { userAgent: hugeUserAgent },
    });

    const row = await db.auditLog.findFirst({
      where: { userId: adminId, action: "test_action_long_ua" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row);
    createdLogIds.push(row!.id);

    assert.ok(row!.userAgent!.length <= 512, "userAgent must be bounded");
    assert.equal(row!.userAgent!.length, 512);
  });

  it("a partial context only overrides the fields it sets, best-effort-filling the rest", async () => {
    const adminId = await findAnyAdminId();

    await logAuditEvent({
      userId: adminId,
      action: "test_action_partial_context",
      entity: "test_entity",
      context: { actorEmail: "only-email@example.com" },
    });

    const row = await db.auditLog.findFirst({
      where: { userId: adminId, action: "test_action_partial_context" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row);
    createdLogIds.push(row!.id);

    assert.equal(row!.actorEmail, "only-email@example.com");
    // No request scope here either, so the fields left for best-effort
    // lookup still resolve to null rather than throwing.
    assert.equal(row!.actorRole, null);
    assert.equal(row!.ipAddress, null);
  });

  // F-290: lets a caller already inside db.$transaction((tx) => ...) commit
  // an audit row atomically with the state change it records (used by the
  // Razorpay webhook's payment transitions) instead of only ever writing
  // through the global `db`.
  it("writes through an explicit `client` (e.g. a transaction client) instead of the global db", async () => {
    const adminId = await findAnyAdminId();

    await db.$transaction((tx) =>
      logAuditEvent({
        userId: adminId,
        action: "test_action_tx_client",
        entity: "test_entity",
        client: tx,
      }),
    );

    const row = await db.auditLog.findFirst({
      where: { userId: adminId, action: "test_action_tx_client" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row, "expected the row to have been committed via the transaction client");
    createdLogIds.push(row!.id);
  });
});
