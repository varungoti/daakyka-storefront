// src/lib/auth/password.ts is already generic bcrypt (cost 12) with no
// admin-specific coupling, so it's reused as-is rather than duplicated here.
export { hashPassword, verifyPassword } from "@/lib/auth/password";

/**
 * A precomputed bcrypt hash (cost 12) of an unknown, unused password.
 *
 * Used by the login route's timing-safe-dummy-compare defense: when the
 * email doesn't match any Customer, we still run `bcrypt.compare()`
 * against *this* hash before returning 401. bcrypt's cost factor
 * dominates request latency, so comparing against a real hash-shaped
 * value (instead of short-circuiting) keeps "unknown email" and "wrong
 * password" responses close enough in timing that an attacker can't use
 * response time to enumerate registered emails.
 */
export const DUMMY_PASSWORD_HASH =
  "$2b$12$Fe.eBrXsczgk/hoXlgfYXODYDn9TTeoVechaz7lUWhZMhHTvOkblm";
