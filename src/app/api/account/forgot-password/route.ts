import { NextResponse } from "next/server";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { sendPasswordResetEmail } from "@/lib/customer-auth/mailer";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { customerForgotPasswordSchema } from "@/lib/validation/schemas";
import { isHoneypotTripped } from "@/lib/validation/honeypot";

// Always the exact same status + body, whether or not the email is
// registered — response shape and timing must not let a caller
// distinguish "no such account" from "reset email sent". Both paths also
// do comparable async work (a token issue + email send attempt) so this
// isn't purely a status-code fig leaf.
const GENERIC_RESPONSE = {
  message: "If an account exists for that email, we've sent a password reset link.",
};

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "account-forgot-password", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    if (isHoneypotTripped(bodyResult.data)) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const parsed = customerForgotPasswordSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      // Even a validation failure (e.g. malformed email) returns the
      // generic response rather than a 400 — the whole point is that this
      // endpoint's response never varies with what was sent.
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const email = parsed.data.email.toLowerCase();
    const customer = await db.customer.findUnique({ where: { email } });

    if (customer && customer.active) {
      const { raw } = await issueCustomerToken(customer.id, "RESET");
      const origin = new URL(request.url).origin;
      const resetLink = `${origin}/account/reset-password?token=${raw}`;
      await sendPasswordResetEmail(customer.email, resetLink);
    }

    return NextResponse.json(GENERIC_RESPONSE);
  } catch {
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
