import { invalidateOutstandingTokens } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

/**
 * Applies a customer's own profile edit (PATCH /api/account/profile).
 *
 * F-133: a password change made while logged in must also revoke every RESET
 * token still sitting unused in an old forgot-password email. forgot-password
 * deliberately allows several outstanding links at once, so without this an
 * emailed reset link kept working for up to an hour after the customer had
 * already changed their password another way. The token revocation shares a
 * transaction with the password write so neither can happen without the
 * other. A name/phone-only edit touches no tokens (and needs no transaction).
 *
 * `passwordHash` must already be hashed — bcrypt is slow and shouldn't hold
 * a DB transaction open, so the route hashes before calling this. Bumping
 * `sessionVersion` is what invalidates every other session for the customer.
 */
export async function updateCustomerProfile(
  customerId: string,
  input: { name?: string; phone?: string | null; passwordHash?: string },
) {
  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.passwordHash ? { passwordHash: input.passwordHash, sessionVersion: { increment: 1 } } : {}),
  };

  if (!input.passwordHash) {
    return db.customer.update({ where: { id: customerId }, data, select: PROFILE_SELECT });
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id: customerId }, data, select: PROFILE_SELECT });
    await invalidateOutstandingTokens(customerId, "RESET", tx);
    return updated;
  });
}
