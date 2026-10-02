import { isProduction } from "@/lib/env";

/**
 * F-043: what to log when a link-bearing email (password reset, account
 * verification, newsletter confirmation) could not be delivered.
 *
 * Outside production the full link is printed with a `[dev]` prefix — that
 * is how a developer without Brevo configured picks the link up (local dev,
 * the integration tests). In production the same line used to be printed
 * too, so with Brevo off or during a Brevo outage every customer's email
 * address and a *working* one-hour password-reset URL landed in the Vercel
 * runtime logs, readable by anyone with log or drain access. Production now
 * logs only a breadcrumb: which kind of email failed, why, and the outbox
 * row that holds it for retry — no recipient, no link.
 */
export function logUndeliveredEmailLink(input: {
  /** Log prefix for the production breadcrumb, e.g. "customer-auth". */
  scope: string;
  /** Human label, e.g. "password reset link". */
  label: string;
  to: string;
  link: string;
  provider?: string;
  outboxId?: string | null;
}): void {
  if (!isProduction()) {
    console.log(`[dev] ${input.label} for ${input.to}: ${input.link}`);
    return;
  }
  console.warn(
    `[${input.scope}] ${input.label} email not delivered (provider=${input.provider ?? "unknown"}, outboxId=${input.outboxId ?? "none"})`,
  );
}
