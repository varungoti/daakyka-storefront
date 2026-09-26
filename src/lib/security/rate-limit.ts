import { createHash } from "node:crypto";
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
 * OPEN by default (logs an error and falls back to an in-memory,
 * per-instance counter) rather than failing closed — a rate-limit outage
 * on most routes should degrade to "a looser, per-instance limit" rather
 * than take the whole site down by 500-ing every request that happens to
 * pass through a rate-limited route. This mirrors the "don't take the
 * whole site down if rate-limit storage hiccups" instruction from the
 * Phase G plan.
 *
 * F-326: that trade-off doesn't hold for the handful of routes lockout is
 * meant to backstop (auth-login, account-login, account-forgot-password,
 * account-register, order-request:*) — an in-memory fallback there is
 * silently `limit * warm-instance-count` on a platform with many
 * short-lived instances, i.e. exactly when the shared brute-force/abuse
 * guard is needed most. Those callers pass `{ failClosed: true }` (see
 * CheckRateLimitOptions) to report a DB error as blocked (503) instead.
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

/**
 * F-326: a limiter DB outage used to log a warning only once per minute
 * (see the removed `warnedAboutDbFailure` throttle this replaced) and,
 * for every route including auth-login/account-login/account-register/
 * account-forgot-password/order-request, silently fall open to a
 * per-instance in-memory counter — on Vercel's many short-lived
 * instances, that turns "5 attempts/min" into "5 * warm-instance-count",
 * with nothing in the logs proportional to how often it's happening (the
 * once-a-minute warning looks identical whether it's 1 fallback or
 * 10,000). Every fallback is now logged at error level, not throttled, so
 * an operator's log-based alert (once F-234 wires one up) actually sees
 * outage volume instead of a single line an hour.
 */
function logRateLimitDbFailure(error: unknown): void {
  console.error(
    "[rate-limit] DB-backed rate limiting unavailable:",
    error instanceof Error ? error.message : error,
  );
}

/**
 * F-326: the fixed Retry-After (seconds) handed back when a
 * fail-closed route's limiter check couldn't reach the DB at all — there
 * is no real bucket state to compute a precise value from, so this is
 * just "wait a few seconds and the DB has likely recovered," short enough
 * that a genuine spike in legitimate traffic isn't locked out for long.
 */
const FAIL_CLOSED_RETRY_AFTER_S = 5;

/** Prunes expired fallback-Map entries at roughly the same rate
 * upsertBucket() sweeps expired DB rows (a random 1% of calls) — the Map
 * has no TTL/expiry of its own and was never cleared before, so a
 * sustained DB outage (or just accumulated one-off keys, like the F-322
 * per-IP+identity buckets) grew it without bound for the life of the
 * process. */
function pruneFallbackBuckets(): void {
  if (Math.random() >= 0.01) return;
  const now = Date.now();
  for (const [key, bucket] of fallbackBuckets) {
    if (bucket.resetAt < now) fallbackBuckets.delete(key);
  }
}

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
  pruneFallbackBuckets();
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

export interface CheckRateLimitOptions {
  /**
   * F-326: routes that lockout is meant to backstop — auth-login,
   * account-login, account-forgot-password, account-register, and
   * order-request:* — must not quietly lose their limit the instant the
   * limiter's DB is unreachable. When true, a DB error here is reported
   * as blocked (`ok: false`) instead of falling back to the in-memory,
   * per-instance counter (which is only a bounded backstop for
   * everything else, and on Vercel's many short-lived instances turns
   * one shared limit into `limit * warm-instance-count`).
   */
  failClosed?: boolean;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options?: CheckRateLimitOptions,
): Promise<{ ok: true } | { ok: false; retryAfter: number; dbUnavailable?: true }> {
  try {
    const { count, resetAt } = await upsertBucket(key, windowMs);

    if (count > limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
      return { ok: false, retryAfter };
    }

    return { ok: true };
  } catch (error) {
    logRateLimitDbFailure(error);

    if (options?.failClosed) {
      return { ok: false, retryAfter: FAIL_CLOSED_RETRY_AFTER_S, dbUnavailable: true };
    }

    // Fail OPEN: see the module-level comment for the reasoning. Fall back
    // to an in-memory, per-process check so a DB blip doesn't remove rate
    // limiting entirely for routes that don't ask to fail closed.
    return checkRateLimitInMemory(key, limit, windowMs);
  }
}

/**
 * F-123: gives back one use of a bucket that was consumed by a request
 * that then failed for a reason the caller (a shopper, not an attacker)
 * can fix and retry — an out-of-stock cart line, an invalid discount code,
 * a broken variant — so retrying a legitimately-broken request doesn't
 * burn down the same identity/IP-scoped limit an abuse script would hit.
 * Best-effort and silent: a failed refund must never surface to the
 * caller, who already has the real (non-rate-limit) error to show. Mirrors
 * upsertBucket's atomicity — GREATEST(count - 1, 0) can't go negative even
 * under a concurrent refund of the same key — and only refunds a bucket
 * still inside its window, so a refund can never resurrect an
 * already-expired/rolled-over bucket.
 */
export async function refundRateLimit(key: string): Promise<void> {
  try {
    await db.$executeRaw`
      UPDATE "RateLimitBucket"
      SET count = GREATEST(count - 1, 0)
      WHERE key = ${key} AND "resetAt" > now()
    `;
  } catch {
    // Best-effort only — see the doc comment above.
  }

  // Keep the in-memory fail-open fallback consistent with the same
  // best-effort semantics, so a refund still behaves sanely during a DB
  // outage (checkRateLimitInMemory is what's actually enforcing limits
  // then).
  const bucket = fallbackBuckets.get(key);
  if (bucket && bucket.count > 0) {
    bucket.count -= 1;
  }
}

/**
 * F-322: sha256 of the trimmed, lowercased identity value (an email or
 * phone) — never the raw value itself, so a RateLimitBucket row (visible
 * to anyone with DB access, and swept only by age) doesn't double as a
 * plaintext log of who attempted what. Not a secret needing a slow hash:
 * this only has to keep the key column from being literally the address,
 * the same reason customer-auth/tokens.ts's hashToken uses sha256 rather
 * than bcrypt for its own non-password random values.
 */
export function hashIdentity(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function tooManyRequestsResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * F-326: what a fail-closed route returns when the limiter's DB is
 * unreachable — deliberately a 503, not the 429 `tooManyRequestsResponse`
 * returns, since this caller isn't actually over any limit; the service
 * backing that check is just down. Still carries Retry-After so a
 * well-behaved client (see the storefront/admin fetch helpers this
 * package also fixed for F-323/F-324) can show a real wait time instead
 * of a bare error.
 */
function serviceUnavailableResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Service temporarily unavailable. Please try again shortly." },
    { status: 503, headers: { "Retry-After": String(retryAfter) } },
  );
}

function responseForBlockedResult(result: { retryAfter: number; dbUnavailable?: true }): NextResponse {
  return result.dbUnavailable
    ? serviceUnavailableResponse(result.retryAfter)
    : tooManyRequestsResponse(result.retryAfter);
}

// F-322: a shared network (hospital Wi-Fi, a carrier's NAT, an office)
// puts many independent shoppers behind one client IP. A tight bucket
// keyed on IP alone throttles them as if they were one abusive caller —
// live-tested at 20 shoppers on one IP: 10/20 checkouts and 7/12 logins
// blocked, with none of them retrying. DEFAULT_IP_BACKSTOP_LIMIT is the
// loose ceiling that still applies per IP (catching a real flood off one
// address, whatever identity it claims), while the *tight* limit the
// caller passes in now applies per IP+identity instead of per IP alone —
// this is what actually stops one attacker from brute-forcing a specific
// account or hammering checkout as themselves, without punishing everyone
// else who happens to share their network.
const DEFAULT_IP_BACKSTOP_LIMIT = 100;

export interface IdentityRateLimitOptions {
  /** The value that scopes the tight bucket — typically the email or
   * phone the request claims to act as. Hashed before it ever reaches a
   * bucket key (see hashIdentity). */
  identity: string;
  /** Loose per-IP ceiling, checked in addition to (not instead of) the
   * tight per-IP+identity bucket. Defaults to DEFAULT_IP_BACKSTOP_LIMIT. */
  backstopLimit?: number;
  /** Defaults to the same window as the tight bucket. */
  backstopWindowMs?: number;
  /** F-326: see CheckRateLimitOptions.failClosed — applied to both the
   * backstop and the identity bucket, so a DB outage can't be dodged by
   * whichever of the two would otherwise have fallen open. */
  failClosed?: boolean;
}

/**
 * Like rateLimitOrResponse, but for routes where the caller supplies an
 * identity (an email on a login/register/checkout attempt) that a script
 * can trivially rotate to dodge a per-IP bucket, while genuine shoppers on
 * the same IP are genuinely different people (F-322). Checks TWO buckets,
 * both must pass:
 *
 *  1. A loose, IP-only backstop (`${route}:ip:<ip>`) — still catches a
 *     flood from one address outright, no matter what identity it claims.
 *  2. A tight, IP+identity bucket (`${route}:id:<ip>:<hash(identity)>`) at
 *     the caller's own `limit`/`windowMs` — this is the bucket that
 *     actually guards against brute-forcing one account or hammering
 *     checkout under one identity; two different identities behind the
 *     same IP get two independent buckets instead of sharing one.
 *
 * Same NODE_ENV=test / DISABLE_RATE_LIMIT=1 / unattributed-IP bypasses as
 * rateLimitOrResponse, for the same reasons — see that function.
 */
export async function identityRateLimitOrResponse(
  request: Request,
  route: string,
  limit: number,
  windowMs: number,
  options: IdentityRateLimitOptions,
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1") {
    return null;
  }

  const ip = getClientIp(request);
  if (ip === null) {
    warnOnceAboutUnattributedIp(route);
    return null;
  }

  const rateLimitOptions = options.failClosed ? { failClosed: true } : undefined;

  const backstopLimit = options.backstopLimit ?? DEFAULT_IP_BACKSTOP_LIMIT;
  const backstopWindowMs = options.backstopWindowMs ?? windowMs;
  const backstop = await checkRateLimit(`${route}:ip:${ip}`, backstopLimit, backstopWindowMs, rateLimitOptions);
  if (!backstop.ok) return responseForBlockedResult(backstop);

  const idKey = `${route}:id:${ip}:${hashIdentity(options.identity)}`;
  const identityResult = await checkRateLimit(idKey, limit, windowMs, rateLimitOptions);
  if (!identityResult.ok) return responseForBlockedResult(identityResult);

  return null;
}

export async function rateLimitOrResponse(
  request: Request,
  route: string,
  limit = 10,
  windowMs = 60_000,
  options?: CheckRateLimitOptions,
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

  const result = await checkRateLimit(`${route}:${ip}`, limit, windowMs, options);
  if (!result.ok) return responseForBlockedResult(result);

  return null;
}
