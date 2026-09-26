import { createHash } from "node:crypto";

/**
 * Fallback admin identity used only when ADMIN_SEED_EMAIL /
 * ADMIN_SEED_PASSWORD are not set. Safe as a default because it isn't a
 * secret — override it with your own address via ADMIN_SEED_EMAIL.
 */
export const DEFAULT_ADMIN_SEED_EMAIL = "admin@example.com";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Generic weak/placeholder passwords prisma/seed.ts refuses to accept for
 * a Vercel (preview or production) deploy. These are common textbook
 * defaults this project has never actually used, so they're safe to keep
 * as plaintext.
 */
export const INSECURE_SEED_PASSWORDS = new Set<string>([
  "password",
  "changeme",
  "admin",
  "admin123",
]);

/**
 * SHA-256 digests of passwords that were this project's REAL SUPER_ADMIN
 * and VIEWER seed defaults at one point and got published in git
 * history, docs and a Vercel build log (F-301 — see docs/ADMIN_CREDENTIALS.md).
 * They are deny-listed by digest, not by value, so the leaked plaintext
 * is never reintroduced to the repo — not even as a "known-bad" example.
 * (There is intentionally no local ADMIN_SEED_PASSWORD default any more:
 * prisma/seed.ts generates a random one when none is set.)
 */
const LEAKED_SEED_PASSWORD_DIGESTS = new Set<string>([
  "c60122eef0f379572315898a19084a6b36ff05333fc6adf0c648e9777f5e6adb", // former published SUPER_ADMIN default
  "1c7da5b5e8f47830852c97475be97424745f5ffe6bb2e04e5736bb8a6ab2233e", // former published VIEWER default
]);

const MIN_SEED_PASSWORD_LENGTH = 12;

/** True when `password` is too weak or a known leaked/default value. */
export function isInsecureSeedPassword(password: string): boolean {
  return (
    password.length < MIN_SEED_PASSWORD_LENGTH ||
    INSECURE_SEED_PASSWORDS.has(password) ||
    LEAKED_SEED_PASSWORD_DIGESTS.has(sha256Hex(password))
  );
}
