import { NextResponse } from "next/server";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { sendPasswordResetEmail } from "@/lib/customer-auth/mailer";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { checkRateLimit, rateLimitOrResponse } from "@/lib/security/rate-limit";
import { customerForgotPasswordSchema } from "@/lib/validation/schemas";
import { isHoneypotTripped } from "@/lib/validation/honeypot";

// F-139: the per-IP limiter below (rateLimitOrResponse) doesn't stop one
// IP from flooding a single victim's inbox, and doesn't stop several IPs
// from doing it together. Mirrors resend-verification's identical
// per-account limiter (same helper, same shape) — keyed by the submitted
// email rather than the caller's IP, so it's bounded regardless of how
// many different IPs ask. Never returns a distinct response on its own:
// unlike resend-verification's 429, forgot-password's whole point is that
// the response never varies with anything about the request, so hitting
// this limit still returns GENERIC_RESPONSE below rather than revealing
// that an account exists (or that a limit was hit at all).
const PER_ACCOUNT_LIMIT = 3;
const PER_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

// Always the exact same status + body, whether or not the email is
// registered — response shape and timing must not let a caller
// distinguish "no such account" from "reset email sent". Both paths also
// do comparable async work (a token issue + email send attempt) so this
// isn't purely a status-code fig leaf.
//
// F7 fix: "we've sent" (past tense, claiming success) was true only when
// Brevo happened to be configured — with Brevo unconfigured, nothing was
// ever actually sent, only attempted and logged. sendPasswordResetEmail
// now persists an unsent attempt to the EmailOutbox for the drain cron to
// retry (src/lib/engagement/outbox.ts), so "on its way" is accurate either
// way: sent momentarily, or queued until Brevo is configured.
const GENERIC_RESPONSE = {
  message: "If an account exists for that email, a password reset link is on its way.",
};

export async function POST(request: Request) {
  // F-326: a limiter DB error here must not silently fall open to a
  // per-instance counter (see rate-limit.ts's CheckRateLimitOptions) — a
  // forgot-password flood is exactly what this limit exists to backstop.
  const limited = await rateLimitOrResponse(request, "account-forgot-password", 5, 60_000, {
    failClosed: true,
  });
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    if (isHoneypotTripped(bodyResult.data, "forgot-password")) {
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

    const accountLimit = await checkRateLimit(
      `account-forgot-password:${email}`,
      PER_ACCOUNT_LIMIT,
      PER_ACCOUNT_WINDOW_MS,
    );
    if (!accountLimit.ok) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

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
