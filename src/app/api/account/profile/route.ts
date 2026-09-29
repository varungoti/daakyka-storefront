import { NextResponse } from "next/server";
import { createCustomerSession, getCustomerSession } from "@/lib/customer-auth/session";
import { hashPassword } from "@/lib/customer-auth/password";
import { invalidateOutstandingTokens } from "@/lib/customer-auth/tokens";
import { lockedResponse, verifyCurrentPassword } from "@/lib/customer-auth/verify-current-password";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { customerProfileUpdateSchema } from "@/lib/validation/schemas";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customer = await db.customer.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, name: true, phone: true, emailVerifiedAt: true, createdAt: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ customer });
}

export async function PATCH(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const parsed = customerProfileUpdateSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    let newPasswordHash: string | undefined;
    if (parsed.data.newPassword) {
      // F-325: this used to let anyone holding a valid session test
      // unlimited currentPassword guesses — 40 wrong guesses in 16s, no
      // 429, no lockout — because it never called either the rate limiter
      // or the same failedLoginCount/lockedUntil counter a login attempt
      // feeds. verifyCurrentPassword now applies both, exactly as a login
      // attempt would (see its doc comment).
      const check = await verifyCurrentPassword(request, session.id, parsed.data.currentPassword!);
      if (check.status === "rate-limited") return check.response;
      if (check.status === "locked") return lockedResponse();
      if (check.status === "incorrect") {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }
      newPasswordHash = await hashPassword(parsed.data.newPassword);
    }

    // Never trust a client-supplied id — always scope the update to the
    // caller's own session id.
    const updateData = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(newPasswordHash ? { passwordHash: newPasswordHash, sessionVersion: { increment: 1 } } : {}),
    };
    // F-133: a password change while logged in must revoke any RESET token
    // still sitting unused in an old forgot-password email — otherwise it
    // kept working after the customer had already changed their password
    // through a different route. Only worth a transaction when there's
    // actually a password change to pair it with.
    const customer = newPasswordHash
      ? await db.$transaction(async (tx) => {
          const updated = await tx.customer.update({
            where: { id: session.id },
            data: updateData,
            select: { id: true, email: true, name: true, phone: true, emailVerifiedAt: true, createdAt: true },
          });
          await invalidateOutstandingTokens(session.id, "RESET", tx);
          return updated;
        })
      : await db.customer.update({
          where: { id: session.id },
          data: updateData,
          select: { id: true, email: true, name: true, phone: true, emailVerifiedAt: true, createdAt: true },
        });

    // Changing the password bumps sessionVersion, which invalidates the
    // token this very request is using — re-issue immediately so the
    // caller doesn't get logged out by their own password change.
    if (newPasswordHash) {
      const refreshed = await db.customer.findUnique({
        where: { id: session.id },
        select: { id: true, email: true, name: true, sessionVersion: true },
      });
      if (refreshed) {
        await createCustomerSession(refreshed);
      }
    }

    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
