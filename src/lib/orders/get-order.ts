import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const ORDER_WITH_ITEMS = { items: { orderBy: { createdAt: "asc" } } } satisfies Prisma.OrderInclude;

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ORDER_WITH_ITEMS }>;

/**
 * Phase D3: view-by-order-number, no additional token.
 *
 * Security trade-off (documented for the release-readiness report): the
 * confirmation page at /order/[number] is reachable by anyone who knows
 * the order number, with no signed token and no login check for guest
 * orders. This is deliberate for this phase — order numbers are
 * `DK-{YYYY}-{6 random digits}` (src/lib/orders/number.ts), not
 * sequential or otherwise guessable, so this is closer to "unlisted" than
 * "public". It is not a substitute for real authorization: a future
 * hardening pass (tracked for Phase G) should require either a logged-in
 * customer who owns the order (once D1 lands) or an emailed
 * confirmation/magic link before showing full order details (address,
 * items, payment ids) to an anonymous visitor.
 */
export async function getOrderByNumber(number: string): Promise<OrderWithItems | null> {
  return db.order.findUnique({ where: { number }, include: ORDER_WITH_ITEMS });
}
