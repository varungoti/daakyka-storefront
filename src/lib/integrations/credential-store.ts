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
}

export const CREDENTIAL_FIELDS: Record<CredentialProvider, CredentialFieldMeta[]> = {
  RAZORPAY: [
    { key: "KEY_ID", label: "Key ID", secret: true },
    { key: "KEY_SECRET", label: "Key Secret", secret: true },
    { key: "WEBHOOK_SECRET", label: "Webhook Secret", secret: true },
  ],
  BREVO: [
    { key: "API_KEY", label: "API Key", secret: true },
    { key: "FROM_EMAIL", label: "From Email", secret: false },
  ],
};

export function isCredentialKey(provider: CredentialProvider, key: string): boolean {
  return CREDENTIAL_FIELDS[provider].some((field) => field.key === key);
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

async function readCredentialFromDb(
  provider: CredentialProvider,
  key: string,
): Promise<string | null> {
  try {
    const row = await db.integrationCredential.findUnique({
      where: { provider_key: { provider, key } },
    });
    if (!row) return null;
    return decrypt(row.valueEncrypted);
  } catch {
    // DB unavailable, or CREDENTIAL_ENCRYPTION_KEY missing/rotated out from
    // under an existing row — callers all already fall back to
    // process.env, so degrade to "not set in the DB" rather than crashing
    // a payment or email flow.
    return null;
  }
}

// Cached per (provider, key) with Next's data cache, tagged so setCredential/
// clearCredential can invalidate every cached credential at once via
// revalidateTag — mirrors src/lib/settings/index.ts's cachedReadSetting.
const cachedReadCredential = unstable_cache(
  async (provider: CredentialProvider, key: string) => readCredentialFromDb(provider, key),
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
    // unstable_cache needs Next's incremental cache / request store, which
    // isn't present outside an actual Next server (unit tests, scripts,
    // etc). Fall back to an uncached read rather than throwing.
    return readCredentialFromDb(provider, key);
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

function invalidateCredentialsCache(): void {
  try {
    revalidateTag(CREDENTIALS_CACHE_TAG, "max");
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
