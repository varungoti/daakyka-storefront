import { consumeCustomerToken, markTokenUsed } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";

export type VerifyEmailResult = { ok: true } | { ok: false; error: string };

/** Shared by the API route (POST/GET /api/account/verify-email) and the
 * /account/verify-email page (which is what the emailed link actually
 * points at) so the consume-and-mark-used logic lives in one place. */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  const result = await consumeCustomerToken(token, "VERIFY");
  if (!result.ok) {
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

  return { ok: true };
}
