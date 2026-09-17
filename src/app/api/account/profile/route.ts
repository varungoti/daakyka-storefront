import { NextResponse } from "next/server";
import { createCustomerSession, getCustomerSession } from "@/lib/customer-auth/session";
import { hashPassword, verifyPassword } from "@/lib/customer-auth/password";
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
      // currentPassword's presence is already enforced by the schema
      // refinement; re-fetch the hash to verify it (session payload
      // doesn't carry it).
      const current = await db.customer.findUnique({
        where: { id: session.id },
        select: { passwordHash: true },
      });
      const valid =
        current && (await verifyPassword(parsed.data.currentPassword!, current.passwordHash));
      if (!valid) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }
      newPasswordHash = await hashPassword(parsed.data.newPassword);
    }

    // Never trust a client-supplied id — always scope the update to the
    // caller's own session id.
    const customer = await db.customer.update({
      where: { id: session.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
        ...(newPasswordHash ? { passwordHash: newPasswordHash, sessionVersion: { increment: 1 } } : {}),
      },
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
