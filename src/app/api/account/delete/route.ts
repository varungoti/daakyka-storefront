import { NextResponse } from "next/server";
import { z } from "zod";
import { destroyCustomerSession, getCustomerSession } from "@/lib/customer-auth/session";
import { lockedResponse, verifyCurrentPassword } from "@/lib/customer-auth/verify-current-password";
import { ErasureBlockedError, erasePersonalData } from "@/lib/privacy/erase";
import { PrivacySubjectError } from "@/lib/privacy/subject";
import { readJsonBody } from "@/lib/security/parse-json-body";

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal("DELETE"),
});

/**
 * F-315: self-service account deletion. Re-checks the password (through
 * verifyCurrentPassword — the same rate limit and lockout counters a login
 * attempt gets, so a stolen session cannot be used to wipe the account
 * without it), then erases the customer and everything else keyed to their
 * email (src/lib/privacy/erase.ts). Orders are anonymised rather than
 * deleted, because their tax figures must be kept; an order that is still
 * being fulfilled blocks the deletion (409) until it is delivered, cancelled
 * or refunded. Only what the session proves is erased: the account's own rows,
 * plus rows keyed to its email once that email is verified (see SubjectTrust in
 * src/lib/privacy/subject.ts) — an unverified account cannot be used to wipe a
 * stranger's orders by registering with their address.
 */
export async function POST(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = deleteAccountSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your password and type DELETE to confirm." }, { status: 400 });
  }

  const check = await verifyCurrentPassword(request, session.id, parsed.data.password);
  if (check.status === "rate-limited") return check.response;
  if (check.status === "locked") return lockedResponse();
  if (check.status === "incorrect") {
    return NextResponse.json({ error: "Your password is incorrect" }, { status: 400 });
  }

  try {
    await erasePersonalData({ customerId: session.id }, { source: "self-service" });
  } catch (error) {
    if (error instanceof ErasureBlockedError) {
      return NextResponse.json(
        {
          error: `You have an order that is still being processed (${error.orderNumbers.join(", ")}). We can delete your account once it has been delivered or cancelled — or contact us and we will do it sooner.`,
          orders: error.orderNumbers,
        },
        { status: 409 },
      );
    }
    if (error instanceof PrivacySubjectError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  await destroyCustomerSession();
  return NextResponse.json({ ok: true });
}
