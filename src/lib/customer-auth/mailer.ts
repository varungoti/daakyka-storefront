import { EMAIL_KIND, sendTransactionalEmail, type EmailKind } from "@/lib/engagement/outbox";

/**
 * Sends (or, when Brevo isn't configured, logs) a customer auth email.
 * Never throws and never fails the calling request — register and
 * forgot-password must succeed from the customer's point of view even if
 * email delivery is unavailable, matching the plan's "never fail the
 * register/forgot-password request just because email couldn't send" rule.
 * When delivery isn't possible we log the raw link with a clear "[dev]"
 * prefix so it can be picked up manually in an environment without Brevo
 * configured (e.g. local dev, this task's runtime verification) — the
 * "[dev] ..." log line is unchanged by the F7 outbox fix below, so it
 * keeps working exactly as before for local/manual testing.
 *
 * F7 fix: goes through sendTransactionalEmail() (src/lib/engagement/
 * outbox.ts) instead of calling sendEmail() directly, so a failed send is
 * *also* durably persisted to EmailOutbox (status PENDING) and retried by
 * the drain-email-outbox cron once Brevo is configured — the "[dev]" log
 * is a local convenience, not the only record anymore.
 */
async function sendOrLogAuthEmail(input: {
  to: string;
  subject: string;
  html: string;
  kind: EmailKind;
  devLabel: string;
  link: string;
}): Promise<void> {
  try {
    const result = await sendTransactionalEmail(
      { to: input.to, subject: input.subject, html: input.html },
      input.kind,
    );
    if (!result.ok) {
      console.log(`[dev] ${input.devLabel} for ${input.to}: ${input.link}`);
    }
  } catch (error) {
    console.log(`[dev] ${input.devLabel} for ${input.to}: ${input.link}`);
    console.warn("[customer-auth] email send threw", error);
  }
}

export async function sendVerificationEmail(email: string, link: string): Promise<void> {
  await sendOrLogAuthEmail({
    to: email,
    subject: "Verify your DAAKYKA Apparels account",
    html: `<p>Welcome to DAAKYKA Apparels. Please verify your email address to finish setting up your account.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
    kind: EMAIL_KIND.CUSTOMER_VERIFY_EMAIL,
    devLabel: "verification link",
    link,
  });
}

export async function sendPasswordResetEmail(email: string, link: string): Promise<void> {
  await sendOrLogAuthEmail({
    to: email,
    subject: "Reset your DAAKYKA Apparels password",
    html: `<p>We received a request to reset your password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
    kind: EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
    devLabel: "password reset link",
    link,
  });
}
