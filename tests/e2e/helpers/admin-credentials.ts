import { DEFAULT_ADMIN_SEED_EMAIL } from "@/lib/auth/seed-defaults";

/**
 * Resolves the admin login these e2e specs use.
 *
 * prisma/seed.ts generates a random ADMIN_SEED_PASSWORD when one isn't
 * set (rather than falling back to a fixed, previously-documented
 * default), so an e2e run has no way to guess it after the fact — the
 * password must be explicitly set in the environment these tests run
 * in, matching whatever seeded the database being tested against.
 */
export function resolveAdminCredentials(): { email: string; password: string } {
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!password) {
    throw new Error(
      "ADMIN_SEED_PASSWORD is not set. Set it (in .env for local runs, or as a CI env var) " +
        "to the same value prisma/seed.ts used to seed the database these tests log into.",
    );
  }
  return {
    email: process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_SEED_EMAIL,
    password,
  };
}
