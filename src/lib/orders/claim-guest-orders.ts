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
 * track orders" idea): it retroactively attaches every still-unclaimed
 * guest order placed under that email to the new/returning account. Once
 * attached, the order shows up in the customer's own order history and
 * starts counting toward src/lib/customers/admin-customers.ts's
 * order-count/spend aggregates and src/lib/reviews/eligibility.ts's
 * verifiedPurchase check, exactly like an order linked at checkout time —
 * both key off `Order.customerId` alone and don't distinguish how it was
 * set.
 *
 * Deliberately keyed on email only (case-insensitive, matching Postgres
 * `citext`-style comparison via Prisma's `mode: "insensitive"`), the same
 * trust boundary customer-auth already relies on elsewhere: registering
 * with an email *is* what establishes "this is my email" today (see the
 * D1 design note in src/app/api/account/register/route.ts — the account is
 * usable immediately, before `emailVerifiedAt` is ever set), and logging in
 * additionally proves the password for that account. This function adds no
 * new trust assumption beyond those.
 *
 * Called from two places, both best-effort — a failure here must never
 * fail the auth flow that triggered it, since an unclaimed order can
 * always be claimed on the next sign-in while a rejected registration or
 * login cannot be undone:
 *  - POST /api/account/register, right after `db.customer.create`, which
 *    covers orders placed as a guest *before* the account existed;
 *  - POST /api/account/login, once credentials check out, which covers
 *    orders placed as a guest *after* it did — checking out logged-out
 *    (expired session, another device, a private window) still leaves
 *    `Order.customerId` null, and registration's claim has long since run.
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
