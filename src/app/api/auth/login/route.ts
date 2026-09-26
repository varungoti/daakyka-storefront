import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { AccountLockedError, isLocked, recordFailedLogin, resetLoginFailures } from "@/lib/auth/lockout";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { loginSchema } from "@/lib/validation/schemas";

// 423 Locked is used consistently across the codebase for "account
// temporarily locked out" (as opposed to 401 for "wrong credentials"),
// matching src/app/api/account/login/route.ts's convention for customers.
const LOCKED_STATUS = 423;

export async function POST(request: Request) {
  // F-326: admin login is exactly the route the account lockout is meant
  // to backstop — a limiter DB error must not quietly fall open to a
  // per-instance counter (see rate-limit.ts's CheckRateLimitOptions).
  const limited = await rateLimitOrResponse(request, "auth-login", 5, 60_000, { failClosed: true });
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = loginSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });

    if (!user || !user.active) {
      // Timing-safe dummy compare: always pay the bcrypt cost even when
      // there's no account to check, so "unknown email" and "wrong
      // password" take the same time and can't be distinguished by an
      // attacker probing for registered admin emails.
      await verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH);
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (isLocked(user)) {
      // F-164: an attempt against an already-locked account never reaches
      // recordFailedLogin, so without this the lockout is invisible on
      // /admin/audit-logs — log it here so every locked-out attempt
      // leaves a trail an admin can review.
      await logAuditEvent({
        userId: user.id,
        action: "login_locked",
        entity: "user",
        entityId: user.id,
        metadata: { lockedUntil: user.lockedUntil },
      });
      return NextResponse.json(
        { error: "Account temporarily locked. Try again later." },
        { status: LOCKED_STATUS },
      );
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      const { locked, lockedUntil } = await recordFailedLogin(user.id);
      // F-164: audit-log both the plain failed attempt and the one that
      // crosses the lockout threshold, so Audit Logs shows failed logins
      // and lockouts instead of only successful ones. Only known, active
      // accounts reach this branch (see the dummy-compare return above),
      // so this can't be used to enumerate which emails have accounts.
      await logAuditEvent({
        userId: user.id,
        action: locked ? "login_locked" : "login_failed",
        entity: "user",
        entityId: user.id,
        metadata: locked ? { lockedUntil } : undefined,
      });
      if (locked) {
        return NextResponse.json(
          { error: "Account temporarily locked. Try again later." },
          { status: LOCKED_STATUS },
        );
      }
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    try {
      await resetLoginFailures(user.id);
    } catch (err) {
      // F-321: a concurrent failed attempt from elsewhere locked the
      // account in the gap between the isLocked() check above and this
      // password-verified reset — see resetLoginFailures's doc comment.
      // No session is issued; audit-log it like the other lockout paths
      // and report the same 423 instead of falling through to a generic
      // 500 below.
      if (err instanceof AccountLockedError) {
        await logAuditEvent({
          userId: user.id,
          action: "login_locked",
          entity: "user",
          entityId: user.id,
          metadata: { lockedUntil: user.lockedUntil, race: true },
        });
        return NextResponse.json(
          { error: "Account temporarily locked. Try again later." },
          { status: LOCKED_STATUS },
        );
      }
      throw err;
    }

    await createSession(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      user.sessionVersion,
    );

    await logAuditEvent({
      userId: user.id,
      action: "login",
      entity: "user",
      entityId: user.id,
    });

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
