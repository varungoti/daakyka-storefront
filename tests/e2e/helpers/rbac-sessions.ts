import { randomUUID } from "node:crypto";
import pg from "pg";
import { SignJWT } from "jose";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { adminRoles } from "@/lib/auth/rbac";
import type { AdminRole } from "@/generated/prisma/client";

/**
 * release-hardening item 2 (F13, docs/audit-2026-09-19/correctness.md):
 * mints a real, signed admin session for every AdminRole so the RBAC
 * permission-matrix spec can make genuine authenticated HTTP requests
 * against the live server started for the `e2e` CI job, instead of only
 * unit-testing hasPermission() in isolation.
 *
 * Uses the `pg` driver directly (not `@/lib/db` / the generated Prisma
 * client) and re-signs the session JWT with `jose` directly (not
 * `signSessionToken` from `@/lib/auth/session`) — deliberately, not out
 * of preference: Playwright's own TypeScript/module transform (separate
 * from the `tsx` runtime every other test file here uses) cannot load
 * `src/generated/prisma/client.ts`'s generated CJS output ("ReferenceError:
 * exports is not defined" — confirmed by trying it). `@/lib/auth/session`
 * imports `@/lib/db`, which imports that generated client, so anything
 * that imports `@/lib/auth/session` — even just for its `signSessionToken`
 * export — pulls that broken chain in transitively. The JWT shape below
 * (sub/email/name/role/sv, HS256, AUTH_SECRET) mirrors
 * `signSessionToken`/`verifySessionToken` in src/lib/auth/session.ts
 * exactly; keep the two in sync if that shape ever changes.
 */

const EMAIL_PREFIX = "rbac-matrix-";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days — matches session.ts

function emailFor(role: AdminRole): string {
  return `${EMAIL_PREFIX}${role.toLowerCase()}@test.local`;
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is required to sign a test session.");
  }
  return new TextEncoder().encode(secret);
}

async function signTestSessionToken(user: {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}): Promise<string> {
  return new SignJWT({ sub: user.id, email: user.email, name: user.name, role: user.role, sv: 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret());
}

export interface RoleSession {
  role: AdminRole;
  cookie: string;
}

/** Creates (or reuses) one throwaway admin user per role directly via SQL
 * and returns a ready-to-send `Cookie` header value for each. Idempotent
 * — safe to call from multiple runs. */
export async function createSessionsForAllRoles(): Promise<Record<AdminRole, RoleSession>> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  try {
    const result: Record<string, RoleSession> = {};
    for (const role of adminRoles) {
      const email = emailFor(role);
      const id = randomUUID();
      const { rows } = await pool.query<{ id: string; email: string; name: string; role: AdminRole }>(
        `INSERT INTO "User" (id, email, name, "passwordHash", role, active, "sessionVersion", "updatedAt")
         VALUES ($1, $2, $3, 'rbac-matrix-test-fixture-unused-hash', $4, true, 0, NOW())
         ON CONFLICT (email) DO UPDATE SET role = $4, active = true, "sessionVersion" = 0, "updatedAt" = NOW()
         RETURNING id, email, name, role`,
        [id, email, `RBAC Matrix ${role}`, role],
      );
      const user = rows[0];
      const token = await signTestSessionToken(user);
      result[role] = { role, cookie: `${ADMIN_SESSION_COOKIE}=${token}` };
    }
    return result as Record<AdminRole, RoleSession>;
  } finally {
    await pool.end();
  }
}

/** Removes every fixture user this helper creates. Matches by email
 * prefix (not tracked ids) so a prior interrupted run's leftovers are
 * always cleaned up too, not just the current run's own rows. */
export async function cleanupRbacMatrixUsers(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  try {
    await pool.query(`DELETE FROM "User" WHERE email LIKE $1`, [`${EMAIL_PREFIX}%`]);
  } finally {
    await pool.end();
  }
}
