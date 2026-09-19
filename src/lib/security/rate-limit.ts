import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isVercel } from "@/lib/env";

/**
 * DB-backed rate limiter (v1 2.1).
 *
 * The previous implementation kept buckets in an in-process `Map`, which
 * works for a single long-lived process but not across the multiple
 * serverless instances a real deployment runs behind — each instance had
 * its own counter, so the effective limit was `limit * instanceCount`.
 * This version stores buckets in the `RateLimitBucket` table and updates
 * them with a single atomic upsert, so every instance shares one counter.
 *
 * Availability trade-off (deliberate): every rate-limited request now costs
 * one DB round trip. If the database is unreachable, `checkRateLimit` fails
 * OPEN (logs a warning and allows the request) rather than failing closed —
 * a rate-limit outage should degrade to "no rate limiting" (bounded risk:
 * spam/brute-force is opportunistic and mitigated elsewhere by lockout,
 * captcha-free honeypots, etc.) rather than take the whole site down by
 * 500-ing every request that happens to pass through a rate-limited route.
 * This mirrors the "don't take the whole site down if rate-limit storage
 * hiccups" instruction from the Phase G plan.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory fallback, used only when NODE_ENV is "test" is NOT the reason
// we skip the DB (see rateLimitOrResponse) — kept solely so a DB outage
// still gives *some* per-process limiting instead of none at all, and so
// resetRateLimits() has something synchronous-ish to clear in addition to
// the DB rows. Not relied upon for correctness across instances.
const fallbackBuckets = new Map<string, Bucket>();

let warnedAboutDbFailure = false;

/**
 * Clears rate-limit buckets. Test-only.
 *
 * Always pass `keyPrefixes`: the integration suite runs ~28 files
 * concurrently against one Postgres, so an unscoped wipe from one file
 * deletes buckets another file is mid-assertion on — which is exactly
 * what made the ORDER_REQUEST throttle test fail on roughly half of all
 * runs. Scope the reset to the key namespaces your test owns (the
 * `route` string passed to rateLimitOrResponse, or the prefix of a key
 * passed to checkRateLimit) and you can't disturb anyone else.
 *
 * Omitting the argument still wipes everything, for the limiter's own
 * unit tests where that's the subject under test.
 */
export async function resetRateLimits(keyPrefixes?: readonly string[]): Promise<void> {
  if (!keyPrefixes) {
    fallbackBuckets.clear();
    try {
      await db.rateLimitBucket.deleteMany({});
    } catch {
      // Best-effort: if the DB isn't reachable there's nothing to reset.
    }
    return;
  }

  for (const key of fallbackBuckets.keys()) {
    if (keyPrefixes.some((prefix) => key.startsWith(prefix))) fallbackBuckets.delete(key);
  }
  try {
    await db.rateLimitBucket.deleteMany({
      where: { OR: keyPrefixes.map((prefix) => ({ key: { startsWith: prefix } })) },
    });
  } catch {
    // Best-effort: if the DB isn't reachable there's nothing to reset.
  }
}

/**
 * Trusted-proxy configuration (v1 2.4 — F1 fix).
 *
 * getClientIp() must never resolve to a value the client itself picked,
 * or every rate limit in the app collapses to "send a different header
 * each time" — verified live: rotating a fake X-Forwarded-For sailed a
 * spoofed login straight through a 5-attempt 429 limit (see
 * docs/audit-2026-09-19/security.md, F1). The only inputs safe to trust
 * are ones a party we already trust — the hosting platform, or an
 * operator-acknowledged reverse proxy — attaches to the request itself,
 * never a header only the client controls.
 *
 * On Vercel (`VERCEL` is set on every Vercel deployment, preview and
 * production alike — see isVercel()), the platform sets
 * x-vercel-forwarded-for and x-real-ip from the real connecting client
 * and, per https://vercel.com/docs/headers/request-headers, "overwrite[s]
 * the X-Forwarded-For header and do[es] not forward external IPs" —
 * i.e. it replaces (not appends to) any client-supplied x-forwarded-for
 * with that same true client IP, unless the project has purchased and
 * enabled Vercel's Enterprise "Trusted Proxy" add-on (not used by this
 * deployment). All three headers are therefore safe to read automatically
 * on Vercel.
 *
 * Off Vercel — a self-hosted `next start`, or plain `next dev`, which is
 * how this bug was originally reproduced — there is no such guarantee:
 * nothing rewrites the headers a client sends, so trusting them by
 * default would just relocate the same bypass. Nothing is trusted there
 * unless an operator explicitly opts in with TRUST_PROXY_HEADERS=1,
 * meant for a deployment that terminates TLS through its own reverse
 * proxy (nginx, etc. — see node_modules/next/dist/docs/01-app/02-guides/
 * self-hosting.md's "Reverse Proxy" section) configured to set x-real-ip
 * or append the true client to x-forwarded-for itself.
 */
function trustsProxyHeaders(): boolean {
  return isVercel() || process.env.TRUST_PROXY_HEADERS === "1";
}

/**
 * Returns the most-trusted client IP for `request`, or `null` when no
 * trustworthy source is configured or present. Precedence (first present
 * wins), all conditional on trustsProxyHeaders():
 *
 *   1. x-vercel-forwarded-for — Vercel's own header; not a conventional
 *      name an upstream (non-Vercel) proxy in front of Vercel would also
 *      be setting, so it survives even that case.
 *   2. x-real-ip — platform/proxy-set to a single IP, never a hop chain.
 *   3. x-forwarded-for — the RIGHTMOST hop only. In a single-trusted-hop
 *      setup (Vercel, or one reverse proxy with TRUST_PROXY_HEADERS=1),
 *      every hop the trusted party itself appends comes after whatever
 *      the client sent, so the last entry is the one it actually
 *      observed; the FIRST entry — the old, vulnerable behavior — is
 *      always attacker-controlled and must never be used.
 *
 * Deliberately returns `null` rather than a constant placeholder like
 * "unknown" when nothing trustworthy is available — see
 * rateLimitOrResponse() for why a shared constant key would itself be an
 * exploitable denial-of-service vector.
 */
export function getClientIp(request: Request): string | null {
  if (!trustsProxyHeaders()) return null;

  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwarded) {
    const ip = vercelForwarded.split(",")[0]?.trim();
    if (ip) return ip;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const trustedHop = hops.at(-1);
    if (trustedHop) return trustedHop;
  }

  return null;
}

let warnedAboutUnattributedIp = false;

/**
 * Warns (once per minute, mirroring checkRateLimit's DB-outage warning
 * below) that a request couldn't be attributed to a trustworthy IP, so
 * an operator running self-hosted without TRUST_PROXY_HEADERS notices in
 * logs that rate limiting is effectively off rather than this degrading
 * silently forever.
 */
function warnOnceAboutUnattributedIp(route: string): void {
  if (warnedAboutUnattributedIp) return;
  warnedAboutUnattributedIp = true;
  console.warn(
    `[rate-limit] no trustworthy client IP for route "${route}" (not on Vercel and ` +
      "TRUST_PROXY_HEADERS is not set) — skipping rate limiting for this request rather " +
      "than sharing one bucket across every unattributed caller. Set TRUST_PROXY_HEADERS=1 " +
      "if this deployment sits behind a trusted reverse proxy. See getClientIp() in " +
      "src/lib/security/rate-limit.ts.",
  );
  setTimeout(() => {
    warnedAboutUnattributedIp = false;
  }, 60_000).unref?.();
}

function checkRateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const bucket = fallbackBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    fallbackBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true };
}

/**
 * Atomically increments (or starts a new) bucket for `key` in a single
 * round trip: `INSERT ... ON CONFLICT DO UPDATE` is safe under concurrent
 * requests from different instances because Postgres serializes the
 * conflicting writes at the row level — there's no read-then-write race
 * like there would be with a separate SELECT followed by an UPDATE.
 *
 * When the existing bucket's window has already expired, the CASE
 * branches reset the count to 1 and push `resetAt` out by another
 * `windowMs`, in the same statement that would otherwise have
 * incremented it — so a single query always does the right thing whether
 * the bucket is fresh, active, or expired.
 */
async function upsertBucket(
  key: string,
  windowMs: number,
): Promise<{ count: number; resetAt: Date }> {
  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimitBucket" AS rlb (key, count, "resetAt")
    VALUES (${key}, 1, now() + (interval '1 millisecond' * ${windowMs}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rlb."resetAt" < now() THEN 1 ELSE rlb.count + 1 END,
      "resetAt" = CASE
        WHEN rlb."resetAt" < now() THEN now() + (interval '1 millisecond' * ${windowMs})
        ELSE rlb."resetAt"
      END
    RETURNING count, "resetAt"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("RateLimitBucket upsert returned no row");
  }

  // Lazy cleanup: on a small fraction of requests, sweep long-expired rows
  // so the table doesn't grow unboundedly. This is intentionally cheap
  // (no cron route, no transaction) and doesn't block the caller's result.
  if (Math.random() < 0.01) {
    db.rateLimitBucket
      .deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
      .catch(() => {
        // Best-effort cleanup; a failure here must never affect the
        // request currently being rate-limited.
      });
  }

  return row;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  try {
    const { count, resetAt } = await upsertBucket(key, windowMs);

    if (count > limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
      return { ok: false, retryAfter };
    }

    return { ok: true };
  } catch (error) {
    // Fail OPEN: see the module-level comment for the reasoning. Fall back
    // to an in-memory, per-process check so a DB blip doesn't remove rate
    // limiting entirely, then log once (not on every request) so an
    // outage is still visible without flooding logs.
    if (!warnedAboutDbFailure) {
      warnedAboutDbFailure = true;
      console.warn(
        "[rate-limit] DB-backed rate limiting unavailable, falling back to in-memory (fail-open):",
        error instanceof Error ? error.message : error,
      );
      setTimeout(() => {
        warnedAboutDbFailure = false;
      }, 60_000).unref?.();
    }
    return checkRateLimitInMemory(key, limit, windowMs);
  }
}

export async function rateLimitOrResponse(
  request: Request,
  route: string,
  limit = 10,
  windowMs = 60_000,
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1") {
    return null;
  }

  const ip = getClientIp(request);
  if (ip === null) {
    // No trustworthy client IP for this request (see getClientIp).
    // Bucketing every unattributed caller under one shared key (e.g.
    // `${route}:unknown`, the pre-fix behavior) would hand a single
    // attacker a way to exhaust that bucket and 429 every *other*
    // unattributed user on the route — a worse outcome than the
    // throttle this function exists to provide. Skip rate limiting for
    // this request instead; it is still backstopped by the independent
    // controls noted in docs/audit-2026-09-19/security.md's F1 entry
    // (per-account lockout on login, server-side re-pricing on
    // checkout, etc).
    warnOnceAboutUnattributedIp(route);
    return null;
  }

  const result = await checkRateLimit(`${route}:${ip}`, limit, windowMs);

  if (!result.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(result.retryAfter) },
      },
    );
  }

  return null;
}
