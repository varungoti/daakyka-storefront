import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { hashOrderAccessToken } from "@/lib/orders/access-token";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { safeEquals } from "@/lib/security/timing-safe-equal";

const ORDER_WITH_ITEMS = { items: { orderBy: { createdAt: "asc" } } } satisfies Prisma.OrderInclude;

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ORDER_WITH_ITEMS }>;

/**
 * Phase G hardening — fixes finding F2 (docs/audit-2026-09-19/security.md):
 * `/order/[number]` used to render full name, shipping address, and line
 * items for *any* order number with no session or ownership check at all.
 * `getAuthorizedOrder` now requires one of two things before returning the
 * order:
 *
 *   1. Ownership — the caller is a logged-in customer whose id matches the
 *      order's `customerId`.
 *   2. Token — the caller presents the order's own high-entropy capability
 *      token (see src/lib/orders/access-token.ts), minted once at checkout
 *      and carried in the confirmation redirect / email link, compared
 *      against the stored hash with the timing-safe `safeEquals`.
 *
 * Every unauthorized case — order doesn't exist, wrong token, missing
 * token, a token that belongs to a *different* order, or a customer
 * session that doesn't own this order — returns `null` identically, so
 * the caller (src/app/order/[number]/page.tsx) always renders the same
 * generic 404 and this function can never be used as an oracle for
 * whether a given order number exists.
 *
 * Deliberately takes `customerId` as an already-resolved plain parameter
 * rather than calling `getCustomerSession()` itself — same reasoning as
 * `loadOwnAddress` (src/lib/customer-auth/addresses.ts) taking an explicit
 * `customerId`: it keeps this function callable directly from tests
 * (`next/headers`'s `cookies()`, which a real session lookup needs, throws
 * outside an actual Next.js request — see the harness note atop
 * tests/integration/customer-auth.test.ts) and keeps all framework/request
 * concerns in the thin page component.
 */
export interface GetAuthorizedOrderInput {
  number: string;
  /** Raw access token from the confirmation URL's `?token=` query string,
   * if present. */
  token?: string | null;
  /** id of the currently logged-in customer, already resolved by the
   * caller (e.g. `(await getCustomerSession())?.id`), or null/undefined
   * for a guest / no session. */
  customerId?: string | null;
}

export async function getAuthorizedOrder({
  number,
  token,
  customerId,
}: GetAuthorizedOrderInput): Promise<OrderWithItems | null> {
  const order = await db.order.findUnique({ where: { number }, include: ORDER_WITH_ITEMS });
  if (!order) return null;

  if (customerId && order.customerId && customerId === order.customerId) {
    return order;
  }

  if (token && order.accessTokenHash) {
    const presentedHash = hashOrderAccessToken(token);
    if (safeEquals(presentedHash, order.accessTokenHash)) {
      return order;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

// 20 requests/minute/IP: generous enough that a guest refreshing their own
// confirmation page (or checking it from a couple of tabs/devices) never
// notices it, but tight enough that — stacked on top of the 10-billion
// value/year keyspace from src/lib/orders/number.ts — enumerating or
// scraping real orders is impractical. Same tier as POST
// /api/checkout/verify (src/app/api/checkout/verify/route.ts).
const ORDER_PAGE_RATE_LIMIT = 20;
const ORDER_PAGE_RATE_WINDOW_MS = 60_000;

/**
 * Throttles `/order/[number]` per client IP. The page is a plain Server
 * Component, not a Route Handler, so it can't use `rateLimitOrResponse`
 * (src/lib/security/rate-limit.ts) — that returns a `NextResponse`, which
 * nothing in a Server Component's render path can hand back to the
 * framework. It calls the lower-level `checkRateLimit` directly instead.
 *
 * Takes `ip` as a plain parameter rather than reading `next/headers`
 * itself, for the same testability reason as `getAuthorizedOrder` above:
 * `headers()` also throws outside a real Next.js request. The page
 * resolves the IP via `getClientIp` (src/lib/security/rate-limit.ts) and
 * passes it in.
 *
 * `getClientIp` returns `null` when there's no trustworthy IP source for
 * this request (off Vercel, without `TRUST_PROXY_HEADERS=1` — see its own
 * doc comment, added by the F1 fix). This mirrors `rateLimitOrResponse`'s
 * handling of that same case: skip rate limiting rather than bucket every
 * unattributed caller under one shared key, which would let a single
 * attacker exhaust that bucket and 429 every other unattributed visitor —
 * worse than no throttle at all.
 */
export async function checkOrderPageRateLimit(
  ip: string | null,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  if (ip === null) return { ok: true };
  return checkRateLimit(`order-page:${ip}`, ORDER_PAGE_RATE_LIMIT, ORDER_PAGE_RATE_WINDOW_MS);
}
