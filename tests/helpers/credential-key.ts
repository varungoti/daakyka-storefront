/**
 * A fixed, non-secret CREDENTIAL_ENCRYPTION_KEY for tests that encrypt or
 * decrypt integration credentials (32 bytes, base64).
 *
 * Production requires the real key (src/lib/env.ts) and a developer's
 * `.env` normally supplies one, but a clean CI runner has no `.env` — so a
 * test that stores a credential or runs strict-mode `validateEnv()` must
 * bring its own key instead of passing only on a machine that happens to
 * have one (F-249). Never use this value outside tests.
 */
export const TEST_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");
