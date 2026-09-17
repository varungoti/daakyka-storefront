import { randomInt } from "node:crypto";

/**
 * Temp-password mechanism for admin invite + admin-triggered password
 * reset (task: "generate a strong random temp password, hash it, create
 * the user, and display the temp password ONCE in the admin UI response
 * for the inviter to relay manually").
 *
 * Chosen over a reset-token-by-email flow (the pattern
 * src/lib/customer-auth/tokens.ts uses for customers) because:
 *  - There's no admin-facing equivalent of CustomerToken in
 *    prisma/schema.prisma, and the task says not to add new models.
 *  - Brevo may be unconfigured (src/lib/engagement/providers/email.ts
 *    already treats that as the common case), so an email-only flow could
 *    silently strand a new admin with no way in.
 *  - The task explicitly offers this as the simpler, secure option.
 *
 * The generated string is never persisted — only its bcrypt hash is
 * (via hashPassword, same as a normal login password) — and the route
 * handler returns the raw value exactly once, in the create/reset
 * response body, for the inviting admin to relay out-of-band.
 */

const WORDLIKE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/O/1/l/i to avoid transcription errors

export function generateTempPassword(): string {
  // 16 chars from a 32-symbol alphabet is ~80 bits of entropy — well
  // beyond brute-forceable, and the restricted alphabet keeps it easy to
  // read aloud/retype without ambiguity.
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += WORDLIKE_CHARS[randomInt(WORDLIKE_CHARS.length)];
  }
  return out;
}
