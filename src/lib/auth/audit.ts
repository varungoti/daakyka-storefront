import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/auth/session";

/** Bounds a stored user-agent string so a hostile/oversized header value
 * never bloats a row — mirrors the length ceiling zod schemas elsewhere in
 * this codebase put on free-text request input. */
const MAX_USER_AGENT_LENGTH = 512;

/** F-289 fix: the actor/network context a caller can already resolve
 * explicitly (e.g. the login route, which has the raw `Request` before any
 * session cookie exists). When a field is omitted, `logAuditEvent` fills it
 * in itself, best-effort, from the current request scope — see below. */
export interface AuditEventContext {
  actorEmail?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * F-289 fix (release-hardening schema-foundation): a password reset, a role
 * change and a deactivation of the same user used to render identically on
 * /admin/audit-logs — only `action`/`entity`/`entityId` were recorded, with
 * no actor role, email or network context to tell them apart. Every caller
 * (34 call sites) already passes `userId`, `action`, `entity`, etc.
 * unchanged; this fills in `actorRole`/`actorEmail`/`ipAddress`/`userAgent`
 * itself, best-effort, rather than requiring every call site to thread a
 * `Request` through — most of them are deep inside service functions
 * (src/lib/catalog/*, src/lib/orders/*, ...) that never see one.
 *
 * `headers()`/`getSession()` only resolve inside an actual Next.js request
 * (a route handler or Server Component) — outside that scope (a script, a
 * unit test, a cron-invoked helper with no incoming request) they throw or
 * return null, which this treats as "no context available" rather than a
 * failure: the audit row is still written, just without those fields. An
 * explicit `context` always wins over the best-effort lookup.
 */
export async function logAuditEvent(input: {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  context?: AuditEventContext;
}) {
  let actorEmail = input.context?.actorEmail ?? null;
  let actorRole = input.context?.actorRole ?? null;
  let ip = input.context?.ip ?? null;
  let userAgent = input.context?.userAgent ?? null;

  if (ip === null || userAgent === null) {
    try {
      const requestHeaders = await headers();
      // getClientIp only ever reads `.headers.get(...)` — see the
      // adaptation comment on the identical pattern in
      // src/app/order/[number]/page.tsx and
      // src/app/account/(dashboard)/orders/[number]/page.tsx.
      if (ip === null) ip = getClientIp({ headers: requestHeaders } as unknown as Request);
      if (userAgent === null) userAgent = requestHeaders.get("user-agent");
    } catch {
      // No request scope — see doc comment above. Never block the audit
      // write over this.
    }
  }

  if (actorEmail === null || actorRole === null) {
    try {
      const session = await getSession();
      if (session) {
        actorEmail ??= session.email;
        actorRole ??= session.role;
      }
    } catch {
      // Same best-effort contract as above.
    }
  }

  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      actorEmail,
      actorRole,
      ipAddress: ip,
      userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
    },
  });
}
