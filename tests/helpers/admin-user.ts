import assert from "node:assert/strict";
import { db } from "@/lib/db";

/**
 * Resolves the id of a stable, seeded admin to attribute test writes to.
 *
 * Every integration file that calls an admin service needs *an* acting
 * user id, and each used to grow its own copy of:
 *
 *     const user = await db.user.findFirst({ select: { id: true } });
 *
 * — no `where`, no `orderBy`, so Postgres was free to return whatever row
 * came back first. The integration suite runs ~36 files concurrently
 * against one database, and several of them create short-lived User rows
 * that they delete again in their own `after()` hook (the lockout admins in
 * tests/integration/admin-auth.test.ts, the invitees in
 * tests/integration/admin-crud-completion.test.ts). Whenever this lookup
 * latched onto one of those, the owning file deleted it mid-test and the
 * next write that stores the acting user as a foreign key failed — most
 * visibly logAuditEvent() (src/lib/auth/audit.ts), called by inviteUser(),
 * dying on `Foreign key constraint violated on the constraint:
 * AuditLog_userId_fkey`.
 *
 * Seeded SUPER_ADMINs are the one row class that is safe to borrow:
 * prisma/seed.ts create-upserts them, and no test creates or deletes one
 * (the single test that targets a SUPER_ADMIN asserts the delete is
 * *blocked*). Ordering by createdAt makes the choice deterministic rather
 * than a function of heap order, so every file agrees on the same id.
 */
export async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  assert.ok(
    user,
    "expected at least one seeded SUPER_ADMIN to exist in the database (run `npm run db:seed`)",
  );
  return user.id;
}
