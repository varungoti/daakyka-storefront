import { db } from "@/lib/db";

/**
 * Release-hardening F-01 / plan item 1.4: guest checkout (see
 * create-order.ts) never creates a `Customer` row — `Order.email`,
 * `Order.phone` and `Order.shippingAddress` are the source of truth for a
 * guest's contact details, and `Order.customerId` simply stays `null`.
 * That means a shopper who checks out as a guest and *later* registers a
 * real account with the same email has no automatic link between their new
 * `Customer` row and the guest orders they already placed.
 *
 * This is the "claim" half of that (the audit's "create an account to
 * track orders" idea): call it right after a `Customer` row is created (or
 * on a later login, if that's ever wired in too) to retroactively attach
 * every still-unclaimed guest order placed under that email to the
 * new/returning account. Once attached, the order shows up in the
 * customer's own order history and starts counting toward
 * src/lib/customers/admin-customers.ts's order-count/spend aggregates and
 * src/lib/reviews/eligibility.ts's verifiedPurchase check, exactly like any
 * order that was linked at checkout time — both key off `Order.customerId`
 * alone and don't distinguish how it was set.
 *
 * Deliberately keyed on email only (case-insensitive, matching Postgres
 * `citext`-style comparison via Prisma's `mode: "insensitive"`), the same
 * trust boundary customer-auth already relies on elsewhere: registering
 * with an email *is* what establishes "this is my email" today (see the
 * D1 design note in src/app/api/account/register/route.ts — the account is
 * usable immediately, before `emailVerifiedAt` is ever set). This
 * function adds no new trust assumption beyond that.
 *
 * NOT YET CALLED from POST /api/account/register — that file is owned by
 * a concurrent agent under this task's file-ownership rules. Wiring it in
 * is a single line: `await linkGuestOrdersToCustomer(customer.id, customer.email)`
 * right after `db.customer.create` succeeds there (and optionally again on
 * login, in case a shopper registered elsewhere/earlier than expected).
 */
export async function linkGuestOrdersToCustomer(customerId: string, email: string): Promise<number> {
  const normalizedEmail = email.trim();
  if (!customerId || !normalizedEmail) return 0;

  const result = await db.order.updateMany({
    where: {
      // Only ever claims genuinely unclaimed guest orders — an order
      // already linked to some other customerId (someone else's account,
      // or this same one from a prior claim) is never touched or
      // reassigned.
      customerId: null,
      email: { equals: normalizedEmail, mode: "insensitive" },
    },
    data: { customerId },
  });

  return result.count;
}
