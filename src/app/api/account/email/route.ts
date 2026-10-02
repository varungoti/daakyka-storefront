import { NextResponse } from "next/server";
import { z } from "zod";
import { requestEmailChange } from "@/lib/customer-auth/email-change";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { lockedResponse, verifyCurrentPassword } from "@/lib/customer-auth/verify-current-password";
import { readJsonBody } from "@/lib/security/parse-json-body";

const changeEmailSchema = z.object({
  newEmail: z.string().trim().email().max(254),
  currentPassword: z.string().min(1).max(200),
});

/**
 * F-315: start an account email change. The new address only takes effect
 * once its owner clicks the link we send there (GET ./confirm), so a typo or
 * someone else's address can never lock the account out. Needs the current
 * password. The response is the same whether or not the address is already
 * registered, so this cannot be used to probe for existing accounts.
 */
export async function POST(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = changeEmailSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address and your current password." }, { status: 400 });
  }

  const check = await verifyCurrentPassword(request, session.id, parsed.data.currentPassword);
  if (check.status === "rate-limited") return check.response;
  if (check.status === "locked") return lockedResponse();
  if (check.status === "incorrect") {
    return NextResponse.json({ error: "Your password is incorrect" }, { status: 400 });
  }

  const result = await requestEmailChange(session.id, parsed.data.newEmail, new URL(request.url).origin);
  if (!result.ok) {
    return NextResponse.json({ error: "That is already your email address." }, { status: 400 });
  }
  return NextResponse.json({
    message: "If that address can be used, we've sent a confirmation link to it. Your email changes once you click it.",
  });
}
