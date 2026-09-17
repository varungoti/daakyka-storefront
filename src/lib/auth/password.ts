import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A precomputed bcrypt hash (cost 12) of an unknown, unused password.
 *
 * Used by the admin login route's timing-safe-dummy-compare defense (same
 * approach as src/lib/customer-auth/password.ts's DUMMY_PASSWORD_HASH):
 * when the email doesn't match any admin User (or the account is
 * inactive), we still run `bcrypt.compare()` against *this* hash before
 * returning 401. bcrypt's cost factor dominates request latency, so
 * comparing against a real hash-shaped value (instead of short-circuiting)
 * keeps "unknown email" and "wrong password" responses close enough in
 * timing that an attacker can't use response time to enumerate admin
 * emails.
 */
export const DUMMY_PASSWORD_HASH =
  "$2b$12$Fe.eBrXsczgk/hoXlgfYXODYDn9TTeoVechaz7lUWhZMhHTvOkblm";
