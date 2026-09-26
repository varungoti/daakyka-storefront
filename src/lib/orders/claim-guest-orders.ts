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
 * F-037 (P0): typing someone's email address is not proof you own it, so
 * this must never run for an unverified account — that would hand every
 * shopper's name, address and order history to anyone who knows their
 * email. The trust boundary is `Customer.emailVerifiedAt`, proven either by
 * clicking the emailed verification link (verify-email.ts) or by
 * completing a password reset, which also goes through an emailed token.
 * Registering an account or merely knowing its password proves neither, so
 * register/route.ts no longer calls this at all, and login/route.ts only
 * calls it when `customer.emailVerifiedAt` is already set. As defence in
 * depth against a future caller reintroducing that mistake, this function
 * re-checks verification itself before claiming anything.
 *
 * Deliberately keyed on email only (case-insensitive, matching Postgres
 * `citext`-style comparison via Prisma's `mode: "insensitive"`) once that
 * verification gate is passed.
 *
 * Called from two places, both best-effort — a failure here must never
 * fail the auth flow that triggered it, since an unclaimed order can
 * always be claimed on the next verified sign-in while a rejected
 * registration or login cannot be undone:
 *  - verifyEmailToken(), right after `emailVerifiedAt` is set, which
 *    covers orders placed as a guest *before* the account existed (or
 *    before it was verified);
 *  - POST /api/account/login, once credentials check out *and* the
 *    account is verified, which covers orders placed as a guest *after*
 *    that — checking out logged-out (expired session, another device, a
 *    private window) still leaves `Order.customerId` null.
 */
export async function linkGuestOrdersToCustomer(customerId: string, email: string): Promise<number> {
  const normalizedEmail = email.trim();
  if (!customerId || !normalizedEmail) return 0;

  // Defence in depth: never claim on behalf of an account that hasn't
  // proven it owns this email, no matter what a caller believes.
  const customer = await db.customer.findFirst({
    where: { id: customerId, emailVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!customer) return 0;

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
