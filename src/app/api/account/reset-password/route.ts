import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/customer-auth/password";
import { claimCustomerToken, consumeCustomerToken, invalidateOutstandingTokens } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { customerResetPasswordSchema } from "@/lib/validation/schemas";

// F-133: thrown when the token passed consumeCustomerToken's pre-check but
// lost the atomic claim inside the transaction (used/expired concurrently,
// or a race with another request presenting the same token) — mapped to
// the same 400 the pre-check itself returns, and rolls the transaction
// back so the password update never applies.
class TokenAlreadyUsedError extends Error {}

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "account-reset-password", 5, 60_000);
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

    // Hash BEFORE opening the transaction — bcrypt is deliberately slow
    // and shouldn't hold a DB transaction (and its row locks) open.
    const passwordHash = await hashPassword(parsed.data.newPassword);

    try {
      await db.$transaction(async (tx) => {
        // F-133: atomically claim the token inside the same transaction as
        // the password update, so two concurrent requests with the same
        // token can't both succeed (consumeCustomerToken above is only a
        // read-only pre-check).
        const claimed = await claimCustomerToken(tx, result.tokenId);
        if (!claimed) throw new TokenAlreadyUsedError();

        // Bumping sessionVersion invalidates every existing session token
        // for this customer (getCustomerSession() rejects a JWT whose
        // embedded `sv` no longer matches the DB) — the "log out all other
        // sessions" requirement for a password reset.
        await tx.customer.update({
          where: { id: result.customerId },
          data: {
            passwordHash,
            sessionVersion: { increment: 1 },
            failedLoginCount: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
          },
        });

        // F-133: a successful reset must revoke every other outstanding
        // RESET token for this customer — otherwise an earlier reset email
        // still sitting in an inbox (forgot-password deliberately allows
        // several outstanding tokens at once) kept working after this one
        // succeeded.
        await invalidateOutstandingTokens(result.customerId, "RESET", tx);
      });
    } catch (err) {
      if (err instanceof TokenAlreadyUsedError) {
        return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}
