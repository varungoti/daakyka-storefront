import { sendVerificationEmail } from "@/lib/customer-auth/mailer";
import { invalidateOutstandingTokens, issueCustomerToken } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";

/**
 * F3 fix (docs/audit-2026-09-19/storefront-ux.md): there was previously no
 * in-app recovery path for a customer whose original verification email
 * never arrived (lost, expired, or — until the F7 fix — silently dropped
 * because Brevo wasn't configured). This is the shared implementation
 * behind POST /api/account/resend-verification, called from the
 * review-gating banner (src/components/product/product-detail.tsx) and
 * the account/profile page (src/components/account/account-tabs.tsx).
 *
 * Deliberately silent about *why* nothing happened in every one of these
 * cases — no account, inactive account, already verified — because the
 * route built on top of this always returns the same generic response
 * either way, matching forgot-password's existing anti-enumeration
 * contract (src/app/api/account/forgot-password/route.ts). Never throws.
 */
export async function resendVerificationEmail(email: string, origin: string): Promise<void> {
  try {
    const normalized = email.toLowerCase();
    const customer = await db.customer.findUnique({ where: { email: normalized } });
    if (!customer || !customer.active || customer.emailVerifiedAt) {
      return;
    }

    // Supersede any earlier outstanding VERIFY token (the original
    // register-time one, or an earlier resend) so only the link this call
    // sends out still works.
    await invalidateOutstandingTokens(customer.id, "VERIFY");

    const { raw } = await issueCustomerToken(customer.id, "VERIFY");
    const verifyLink = `${origin}/account/verify-email?token=${raw}`;
    await sendVerificationEmail(customer.email, verifyLink);
  } catch (error) {
    console.warn("[customer-auth] resendVerificationEmail failed", error);
  }
}
