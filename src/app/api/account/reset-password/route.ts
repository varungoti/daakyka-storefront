import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/customer-auth/password";
import { consumeCustomerToken, markTokenUsed } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { customerResetPasswordSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "account-reset-password", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const parsed = customerResetPasswordSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await consumeCustomerToken(parsed.data.token, "RESET");
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);

    // Bumping sessionVersion invalidates every existing session token for
    // this customer (getCustomerSession() rejects a JWT whose embedded
    // `sv` no longer matches the DB) — the "log out all other sessions"
    // requirement for a password reset.
    await db.customer.update({
      where: { id: result.customerId },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    });
    await markTokenUsed(result.tokenId);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}
