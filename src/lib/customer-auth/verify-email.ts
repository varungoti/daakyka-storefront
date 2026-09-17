import { consumeCustomerToken, markTokenUsed } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";

export type VerifyEmailResult = { ok: true } | { ok: false; error: string };

/** Shared by the API route (POST/GET /api/account/verify-email) and the
 * /account/verify-email page (which is what the emailed link actually
 * points at) so the consume-and-mark-used logic lives in one place. */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  const result = await consumeCustomerToken(token, "VERIFY");
  if (!result.ok) {
    return { ok: false, error: "Invalid or expired verification link" };
  }

  await db.customer.update({
    where: { id: result.customerId },
    data: { emailVerifiedAt: new Date() },
  });
  await markTokenUsed(result.tokenId);

  return { ok: true };
}
