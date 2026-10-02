import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * F-043: a queued reset / verification / order-confirmation email carries a
 * *live credential* in its body (the raw reset token, the order access
 * link). Customer tokens are hash-only everywhere else on purpose
 * (src/lib/customer-auth/tokens.ts, src/lib/orders/access-token.ts), but
 * the outbox used to keep the rendered HTML — raw token included — in
 * plaintext, forever. Anyone able to read the table (a SQL console, a DB
 * dump, a backup) could take over an account or open a guest order.
 *
 * The body still has to survive until the email is delivered: a PENDING
 * row is retried by the drain cron once Brevo is reachable. So for the
 * credential-bearing kinds the body is *sealed* (AES-256-GCM) while the
 * row waits, and replaced by a fixed placeholder as soon as the row
 * reaches a terminal state (see outbox.ts). Only the running app, which
 * holds AUTH_SECRET, can read a sealed body; a copy of the database alone
 * cannot.
 *
 * The key is derived from AUTH_SECRET by HKDF with its own label — never
 * AUTH_SECRET itself, which also signs session JWTs (same approach as
 * src/lib/orders/access-token.ts's order-link key). If AUTH_SECRET is ever
 * rotated, rows sealed under the old one can no longer be opened; the
 * drain marks those FAILED (their links are at most 24 hours old and the
 * customer can simply ask for a new one).
 */

const SEAL_PREFIX = "sealed:v1:";

/** What a credential-bearing row's `html` is replaced with once it no
 * longer needs a body (delivered, expired, superseded or failed). */
export const REDACTED_BODY = "[body redacted]";

export interface OutboxBody {
  html: string;
  text: string | null;
}

function deriveSealKey(): Buffer {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    throw new Error("AUTH_SECRET environment variable is required");
  }
  return Buffer.from(hkdfSync("sha256", authSecret, "", "daakyka:email-outbox-seal:v1", 32));
}

export function isSealedBody(stored: string): boolean {
  return stored.startsWith(SEAL_PREFIX);
}

/** Encrypts a body for storage in `EmailOutbox.html`. Throws if AUTH_SECRET
 * is missing — callers fail closed rather than store a credential in the
 * clear. */
export function sealOutboxBody(body: OutboxBody): string {
  const key = deriveSealKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEAL_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

/**
 * The body to actually send for a stored row. A row that was never sealed
 * (every non-credential kind, and rows queued before this fix) passes
 * through unchanged. Returns `null` for a sealed row that can't be opened
 * (AUTH_SECRET changed, or the value was tampered with) — the caller must
 * not send it.
 */
export function openOutboxBody(storedHtml: string, storedText: string | null): OutboxBody | null {
  if (!isSealedBody(storedHtml)) return { html: storedHtml, text: storedText };
  try {
    const raw = Buffer.from(storedHtml.slice(SEAL_PREFIX.length), "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveSealKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as Partial<OutboxBody>;
    if (typeof parsed.html !== "string") return null;
    return { html: parsed.html, text: typeof parsed.text === "string" ? parsed.text : null };
  } catch {
    return null;
  }
}
