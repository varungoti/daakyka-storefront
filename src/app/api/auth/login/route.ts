import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { isLocked, recordFailedLogin, resetLoginFailures } from "@/lib/auth/lockout";
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
  const limited = await rateLimitOrResponse(request, "auth-login", 5, 60_000);
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
      return NextResponse.json(
        { error: "Account temporarily locked. Try again later." },
        { status: LOCKED_STATUS },
      );
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      const { locked } = await recordFailedLogin(user.id);
      if (locked) {
        return NextResponse.json(
          { error: "Account temporarily locked. Try again later." },
          { status: LOCKED_STATUS },
        );
      }
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    await resetLoginFailures(user.id);

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
