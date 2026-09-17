/**
 * Fallback admin identity used only when ADMIN_SEED_EMAIL /
 * ADMIN_SEED_PASSWORD are not set. Safe as a default because it isn't a
 * secret — override it with your own address via ADMIN_SEED_EMAIL.
 */
export const DEFAULT_ADMIN_SEED_EMAIL = "admin@example.com";

/**
 * Local-development-only fallback password, used solely when
 * ADMIN_SEED_PASSWORD is unset AND prisma/seed.ts detects it is NOT
 * running on Vercel. It is intentionally listed in
 * INSECURE_SEED_PASSWORDS below so it can never be used — even if
 * explicitly set via ADMIN_SEED_PASSWORD — for an actual Vercel deploy.
 */
export const DEFAULT_ADMIN_SEED_PASSWORD = "Daakyka@2026";

/**
 * Passwords prisma/seed.ts refuses to accept for a Vercel (preview or
 * production) deploy, no matter where they came from — including a
 * password an operator pasted into ADMIN_SEED_PASSWORD by copying an
 * old default out of documentation or git history.
 */
export const INSECURE_SEED_PASSWORDS = new Set<string>([
  DEFAULT_ADMIN_SEED_PASSWORD,
  "Daakyka@Viewer2026",
  "password",
  "changeme",
  "admin",
  "admin123",
]);

const MIN_SEED_PASSWORD_LENGTH = 12;

/** True when `password` is too weak or a known leaked/default value. */
export function isInsecureSeedPassword(password: string): boolean {
  return (
    password.length < MIN_SEED_PASSWORD_LENGTH ||
    INSECURE_SEED_PASSWORDS.has(password)
  );
}
