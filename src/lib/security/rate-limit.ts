import { NextResponse } from "next/server";
import { db } from "@/lib/db";

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

export async function resetRateLimits(): Promise<void> {
  fallbackBuckets.clear();
  try {
    await db.rateLimitBucket.deleteMany({});
  } catch {
    // Best-effort: if the DB isn't reachable there's nothing to reset.
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
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
