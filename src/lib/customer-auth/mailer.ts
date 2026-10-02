import { EMAIL_KIND, sendTransactionalEmail, type EmailKind } from "@/lib/engagement/outbox";
import { escapeHtml } from "@/lib/email/html";
import { button, loadEmailFooter, paragraph, renderEmailLayout } from "@/lib/email/layout";
import { logUndeliveredEmailLink } from "@/lib/email/dev-log";

/**
 * Sends (or, when Brevo isn't configured, logs) a customer auth email.
 * Never throws and never fails the calling request — register and
 * forgot-password must succeed from the customer's point of view even if
 * email delivery is unavailable, matching the plan's "never fail the
 * register/forgot-password request just because email couldn't send" rule.
 * When delivery isn't possible *outside production* we log the raw link
 * with a clear "[dev]" prefix so it can be picked up manually in an
 * environment without Brevo configured (e.g. local dev, this task's runtime
 * verification).
 *
 * F-043: in production that log line is gone — it printed the customer's
 * address and a live reset URL into the platform's runtime logs whenever
 * Brevo was off or erroring. Production logs a redacted breadcrumb instead
 * (see src/lib/email/dev-log.ts), and the queued body is sealed at rest by
 * the outbox (src/lib/engagement/outbox-seal.ts).
 *
 * F7 fix: goes through sendTransactionalEmail() (src/lib/engagement/
 * outbox.ts) instead of calling sendEmail() directly, so a failed send is
 * *also* durably persisted to EmailOutbox (status PENDING) and retried by
 * the drain-email-outbox cron once Brevo is configured.
 *
 * F-041: rendered through the shared branded layout (src/lib/email/
 * layout.ts) with an explicit plain-text part that keeps the link — the
 * old tag-stripped fallback dropped every URL.
 */
async function sendOrLogAuthEmail(input: {
  to: string;
  subject: string;
  heading: string;
  /** Escaped HTML paragraphs above the button. */
  introHtml: string;
  intro: string;
  buttonLabel: string;
  /** Escaped HTML small print below the button (expiry, "ignore this"). */
  noteHtml: string;
  note: string;
  kind: EmailKind;
  devLabel: string;
  link: string;
}): Promise<void> {
  try {
    const footer = await loadEmailFooter();
    const { html, text } = renderEmailLayout({
      subject: input.subject,
      heading: input.heading,
      bodyHtml:
        input.introHtml +
        button(input.buttonLabel, input.link) +
        paragraph(
          `<span style="font-size:13px;color:#6b6475;">If the button doesn&rsquo;t work, copy and paste this link into your browser:<br><a href="${escapeHtml(input.link)}" style="color:#8a347d;word-break:break-all;">${escapeHtml(input.link)}</a></span>`,
        ) +
        input.noteHtml,
      bodyText: `${input.intro}\n\n${input.buttonLabel}: ${input.link}\n\n${input.note}`,
      footer,
    });
    const result = await sendTransactionalEmail({ to: input.to, subject: input.subject, html, text }, input.kind);
    if (!result.ok) {
      logUndeliveredEmailLink({
        scope: "customer-auth",
        label: input.devLabel,
        to: input.to,
        link: input.link,
        provider: result.provider,
        outboxId: result.outboxId,
      });
    }
  } catch (error) {
    logUndeliveredEmailLink({ scope: "customer-auth", label: input.devLabel, to: input.to, link: input.link });
    console.warn("[customer-auth] email send threw", error instanceof Error ? error.message : "unknown error");
  }
}

export async function sendVerificationEmail(email: string, link: string): Promise<void> {
  await sendOrLogAuthEmail({
    to: email,
    subject: "Verify your DAAKYKA Apparels account",
    heading: "Verify your email address",
    intro: "Welcome to DAAKYKA Apparels. Please verify your email address to finish setting up your account.",
    introHtml: paragraph("Welcome to DAAKYKA Apparels. Please verify your email address to finish setting up your account."),
    buttonLabel: "Verify email",
    note: "This link expires in 24 hours.",
    noteHtml: paragraph("This link expires in 24 hours."),
    kind: EMAIL_KIND.CUSTOMER_VERIFY_EMAIL,
    devLabel: "verification link",
    link,
  });
}

export async function sendPasswordResetEmail(email: string, link: string): Promise<void> {
  await sendOrLogAuthEmail({
    to: email,
    subject: "Reset your DAAKYKA Apparels password",
    heading: "Reset your password",
    intro: "We received a request to reset your password.",
    introHtml: paragraph("We received a request to reset your password."),
    buttonLabel: "Reset password",
    note: "This link expires in 1 hour. If you didn't request this, you can ignore this email.",
    noteHtml: paragraph("This link expires in 1 hour. If you didn&rsquo;t request this, you can ignore this email."),
    kind: EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
    devLabel: "password reset link",
    link,
  });
}

/** F-315: asks the shopper to confirm a new account email. Goes to the NEW
 * address, so only someone who can read it can complete the change. */
export async function sendEmailChangeEmail(newEmail: string, link: string): Promise<void> {
  await sendOrLogAuthEmail({
    to: newEmail,
    subject: "Confirm your new DAAKYKA Apparels email address",
    heading: "Confirm your new email address",
    intro: "We received a request to use this address for your DAAKYKA Apparels account.",
    introHtml: paragraph("We received a request to use this address for your DAAKYKA Apparels account."),
    buttonLabel: "Confirm email address",
    note: "This link expires in 24 hours. If you didn't ask for this, you can ignore this email and nothing will change.",
    noteHtml: paragraph(
      "This link expires in 24 hours. If you didn&rsquo;t ask for this, you can ignore this email and nothing will change.",
    ),
    kind: EMAIL_KIND.CUSTOMER_EMAIL_CHANGE,
    devLabel: "email change link",
    link,
  });
}

/** F-315: tells the OLD address that the account email was changed, so an
 * account takeover that swaps the address can't go unnoticed. Best-effort
 * like every other sender here. */
export async function sendEmailChangedNotice(oldEmail: string, newEmail: string): Promise<void> {
  try {
    const subject = "Your DAAKYKA Apparels email address was changed";
    const footer = await loadEmailFooter();
    const intro = `The email address on your DAAKYKA Apparels account was changed to ${newEmail}. Sign-in links will now go to that address.`;
    const note = "If this wasn't you, contact us straight away and we'll secure your account.";
    const { html, text } = renderEmailLayout({
      subject,
      heading: "Your email address was changed",
      bodyHtml: paragraph(escapeHtml(intro)) + paragraph(escapeHtml(note)),
      bodyText: `${intro}\n\n${note}`,
      footer,
    });
    await sendTransactionalEmail({ to: oldEmail, subject, html, text }, EMAIL_KIND.CUSTOMER_EMAIL_CHANGED_NOTICE);
  } catch (error) {
    console.warn("[customer-auth] email-changed notice failed", error instanceof Error ? error.message : "unknown error");
  }
}
