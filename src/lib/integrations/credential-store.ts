import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import type { CredentialProvider } from "@/generated/prisma/client";

export type { CredentialProvider } from "@/generated/prisma/client";

/**
 * Admin-settable third-party credentials (Razorpay keys, Brevo API key),
 * stored encrypted so they can be entered through the admin UI after the
 * site is already live — no redeploy, no touching Vercel env vars. Every
 * read site checks this store first and falls back to process.env, so an
 * env-var-only deploy keeps working exactly as before.
 */
export interface CredentialFieldMeta {
  key: string;
  label: string;
  /** Masked in the admin UI ("•••• configured") — every field here is,
   * except BREVO/FROM_EMAIL, which is plain config, not a secret. */
  secret: boolean;
  /** Helper text shown under the field in the admin form. */
  hint?: string;
}

export const CREDENTIAL_FIELDS: Record<CredentialProvider, CredentialFieldMeta[]> = {
  RAZORPAY: [
    { key: "KEY_ID", label: "Key ID", secret: true },
    { key: "KEY_SECRET", label: "Key Secret", secret: true },
    { key: "WEBHOOK_SECRET", label: "Webhook Secret", secret: true },
  ],
  BREVO: [
    { key: "API_KEY", label: "API Key", secret: true },
    {
      key: "FROM_EMAIL",
      label: "From Email",
      secret: false,
      // F-267: required (src/lib/integrations/status.ts won't call Brevo
      // configured without it), and Brevo rejects any sender it hasn't verified.
      hint: "Required. Use a sender address or domain you've verified in Brevo — otherwise Brevo rejects every email.",
    },
  ],
};

export function isCredentialKey(provider: CredentialProvider, key: string): boolean {
  return CREDENTIAL_FIELDS[provider].some((field) => field.key === key);
}

// F-215 fix: previously any 1-500 character string was accepted for any
// field, so a mistyped Razorpay key or a Brevo key pasted into the wrong
// field went straight to "CONFIGURED" and only broke checkout/email later.
// These are cheap, provider-documented shape checks — not a substitute for
// the "Test connection" endpoint (src/app/api/admin/integrations/[provider]/
// test/route.ts), which is what actually proves a key works.
const RAZORPAY_KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{8,}$/;
const BREVO_API_KEY_PATTERN = /^xkeysib-/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a user-facing error message if `value` doesn't look like a valid
 * value for this (provider, key), or `null` if it's fine to save. */
export function validateCredentialFormat(
  provider: CredentialProvider,
  key: string,
  value: string,
): string | null {
  if (provider === "RAZORPAY" && key === "KEY_ID" && !RAZORPAY_KEY_ID_PATTERN.test(value)) {
    return "Razorpay Key ID should look like rzp_test_… or rzp_live_…";
  }
  if (provider === "BREVO" && key === "API_KEY" && !BREVO_API_KEY_PATTERN.test(value)) {
    return "Brevo API keys start with xkeysib-";
  }
  if (provider === "BREVO" && key === "FROM_EMAIL" && !EMAIL_PATTERN.test(value)) {
    return "Enter a valid email address";
  }
  return null;
}

export const CREDENTIALS_CACHE_TAG = "integration-credentials";

/**
 * The root encryption key is app-level infrastructure (like AUTH_SECRET):
 * set once via the hosting platform's env vars, not something rotated
 * through this admin UI. Rotating it would silently break decryption of
 * every previously-stored credential, so it deliberately lives outside the
 * thing it protects.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set — cannot read or write integration credentials",
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits) — generate one with " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`",
    );
  }
  return key;
}

// AES-256-GCM: authenticated encryption, so a tampered ciphertext (e.g. a
// row edited directly in the DB) fails to decrypt instead of silently
// producing garbage that gets used as a live API key. A 12-byte nonce is
// the size GCM is specified and optimized for; it's random per encryption
// so the same plaintext never produces the same ciphertext twice.
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const key = getEncryptionKey();
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted credential payload");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// F-222: this is the function unstable_cache wraps below, so — like
// settings/index.ts's fetchSettingFromDb — it must let a DB error, or a
// decrypt failure (CREDENTIAL_ENCRYPTION_KEY missing/rotated out from under
// an existing row), propagate rather than swallow it. unstable_cache only
// ever caches a *resolved* value, so catching the error here and returning
// null used to get that null cached as "not set in the DB" for up to a
// year — which can silently turn Razorpay off (isRazorpayConfigured() sees
// null with no env fallback) or freeze the Brevo key. Returning null is
// still correct, and safe to cache, for a genuinely missing row.
// getCredential() below applies the "not set" fallback for a failed read
// *outside* the cache boundary instead, so a transient failure only ever
// affects the one call that hit it — every caller already falls back to
// process.env exactly as before.
async function fetchCredentialFromDb(
  provider: CredentialProvider,
  key: string,
): Promise<string | null> {
  const row = await db.integrationCredential.findUnique({
    where: { provider_key: { provider, key } },
  });
  if (!row) return null;
  return decrypt(row.valueEncrypted);
}

// Cached per (provider, key) with Next's data cache, tagged so setCredential/
// clearCredential can invalidate every cached credential at once via
// revalidateTag — mirrors src/lib/settings/index.ts's cachedReadSetting.
const cachedReadCredential = unstable_cache(
  async (provider: CredentialProvider, key: string) => fetchCredentialFromDb(provider, key),
  ["integration-credential"],
  { tags: [CREDENTIALS_CACHE_TAG] },
);

export async function getCredential(
  provider: CredentialProvider,
  key: string,
): Promise<string | null> {
  try {
    return await cachedReadCredential(provider, key);
  } catch {
    // Two different situations land here, and both are handled the same
    // way: either unstable_cache's incremental cache / request store isn't
    // present (unit tests, scripts, outside an actual Next server), or the
    // read itself failed. Retry once, uncached, and degrade to "not set in
    // the DB" on any further failure — never cache a failure as if it were
    // a real answer.
    try {
      return await fetchCredentialFromDb(provider, key);
    } catch {
      return null;
    }
  }
}

export interface CredentialMeta {
  configured: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** Uncached: only read by the low-traffic admin settings page, and must
 * always reflect the very latest write (e.g. right after a save). */
export async function getCredentialMeta(
  provider: CredentialProvider,
  key: string,
): Promise<CredentialMeta> {
  const row = await db.integrationCredential.findUnique({
    where: { provider_key: { provider, key } },
    include: { updatedBy: { select: { name: true } } },
  });
  if (!row) return { configured: false, updatedAt: null, updatedByName: null };
  return {
    configured: true,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedBy?.name ?? null,
  };
}

// F-215 fix: this used to be `revalidateTag(CREDENTIALS_CACHE_TAG, "max")`.
// Per the Next 16 docs (node_modules/next/dist/docs/01-app/03-api-reference/
// 04-functions/revalidateTag.md), "max" is stale-while-revalidate — the very
// next read after a save/clear is still served the *old* cached value while
// a fresh one loads in the background. That meant a cleared or rotated
// Razorpay/Brevo credential kept being used by sendEmail() and the Razorpay
// key resolution (both go through getCredential() below) for one more
// request after an admin rotated it, and the /admin/integrations status
// badge could show "configured" for one load after a Clear. `updateTag`
// would avoid this outright, but it only works inside Server Actions —
// these writes happen in a Route Handler (see the credentials API route) —
// so `{ expire: 0 }` is the documented alternative: it never serves stale
// data, making the next read a blocking revalidate instead.
//
// Exported (rather than inlined) so a test can pin this exact value:
// `unstable_cache`/`revalidateTag` only do anything inside a real Next.js
// request (see getCredential's catch block below), so a plain `tsx --test`
// run can never exercise the actual stale-vs-fresh behavior end to end —
// this constant is the one part of the fix a unit test *can* verify.
export const CREDENTIALS_CACHE_REVALIDATE_PROFILE = { expire: 0 } as const;

function invalidateCredentialsCache(): void {
  try {
    revalidateTag(CREDENTIALS_CACHE_TAG, CREDENTIALS_CACHE_REVALIDATE_PROFILE);
  } catch {
    // No static generation store in this context (unit tests, scripts) —
    // nothing to revalidate.
  }
}

export async function setCredential(
  provider: CredentialProvider,
  key: string,
  value: string,
  updatedById: string,
): Promise<void> {
  const valueEncrypted = encrypt(value);

  await db.integrationCredential.upsert({
    where: { provider_key: { provider, key } },
    create: { provider, key, valueEncrypted, updatedById },
    update: { valueEncrypted, updatedById },
  });

  // Never log the actual secret value — only that it changed.
  await logAuditEvent({
    userId: updatedById,
    action: "update",
    entity: "integration_credential",
    entityId: `${provider}:${key}`,
  });

  invalidateCredentialsCache();
}

export async function clearCredential(
  provider: CredentialProvider,
  key: string,
  updatedById: string,
): Promise<void> {
  await db.integrationCredential.deleteMany({ where: { provider, key } });

  await logAuditEvent({
    userId: updatedById,
    action: "clear",
    entity: "integration_credential",
    entityId: `${provider}:${key}`,
  });

  invalidateCredentialsCache();
}
