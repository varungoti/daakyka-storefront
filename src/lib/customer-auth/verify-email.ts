import { consumeCustomerToken, hashToken, markTokenUsed } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";

export type VerifyEmailResult =
  | {
      ok: true;
      /** True when this link had already been used (or has lapsed) but the
       * account's email is verified anyway — see verifyEmailToken. */
      alreadyVerified: boolean;
    }
  | { ok: false; error: string };

/**
 * F-136: whether the customer a VERIFY token was issued to has a verified
 * email. Only ever asked about a token the caller already holds (the raw value
 * is hashed for the lookup, same as consumeCustomerToken), so it tells nobody
 * anything they could not already see by owning the link.
 */
async function ownerOfVerifyTokenIsVerified(rawToken: string): Promise<boolean> {
  const record = await db.customerToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { type: true, customer: { select: { emailVerifiedAt: true } } },
  });
  return record?.type === "VERIFY" && record.customer.emailVerifiedAt !== null;
}

/** Shared by the API route (POST/GET /api/account/verify-email) and the
 * /account/verify-email page (which is what the emailed link actually
 * points at) so the consume-and-mark-used logic lives in one place. */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  const result = await consumeCustomerToken(token, "VERIFY");
  if (!result.ok) {
    // F-136: the link is spent (or its day is up), but if the account's email
    // is verified that is exactly what the person wanted — typically a mail
    // scanner (Outlook Safe Links and similar) opened the link before they
    // did, or they clicked it twice. Telling them "Verification Failed" there
    // is a false alarm. A spent link on an account that is NOT verified (one
    // superseded by a resend, say) still fails.
    if ((result.reason === "used" || result.reason === "expired") && (await ownerOfVerifyTokenIsVerified(token))) {
      return { ok: true, alreadyVerified: true };
    }
    return { ok: false, error: "Invalid or expired verification link" };
  }

  const customer = await db.customer.update({
    where: { id: result.customerId },
    data: { emailVerifiedAt: new Date() },
    select: { id: true, email: true },
  });
  await markTokenUsed(result.tokenId);

  // F-037: this is the moment the account first proves it owns the
  // address, so it's the moment any guest orders placed under it become
  // claimable. Best-effort — a claim failure must never turn a successful
  // verification into an error response.
  try {
    await linkGuestOrdersToCustomer(customer.id, customer.email);
  } catch {
    // Intentionally swallowed — see above.
  }

  return { ok: true, alreadyVerified: false };
}
