import { NextResponse } from "next/server";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/customer-auth/password";
import { createCustomerSession } from "@/lib/customer-auth/session";
import {
  AccountLockedError,
  isLocked,
  recordFailedLogin,
  resetLoginFailures,
} from "@/lib/customer-auth/lockout";
import { db } from "@/lib/db";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { identityRateLimitOrResponse } from "@/lib/security/rate-limit";
import { loginSchema } from "@/lib/validation/schemas";

// 423 Locked is used consistently across D1 for "account temporarily
// locked out" (as opposed to 401 for "wrong credentials" and 403 for
// "authenticated but not allowed to touch this resource").
const LOCKED_STATUS = 423;

export async function POST(request: Request) {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = loginSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();

  // F-322: keyed on IP+email (plus a loose per-IP backstop) rather than
  // IP alone — many independent shoppers signing in from one shared
  // network (hospital Wi-Fi) must not lock each other out of the login
  // form. Per-account brute-force protection still comes from the lockout
  // check below, which is identity-only by design.
  const limited = await identityRateLimitOrResponse(request, "account-login", 5, 60_000, {
    identity: email,
  });
  if (limited) return limited;

  try {
    const customer = await db.customer.findUnique({ where: { email } });

    if (!customer || !customer.active) {
      // Timing-safe dummy compare: always pay the bcrypt cost even when
      // there's no account to check, so "unknown email" and "wrong
      // password" take the same time and can't be distinguished by an
      // attacker probing for registered emails.
      await verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH);
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (isLocked(customer)) {
      return NextResponse.json(
        { error: "Account temporarily locked. Try again later." },
        { status: LOCKED_STATUS },
      );
    }

    const valid = await verifyPassword(parsed.data.password, customer.passwordHash);
    if (!valid) {
      const { locked } = await recordFailedLogin(customer.id);
      if (locked) {
        return NextResponse.json(
          { error: "Account temporarily locked. Try again later." },
          { status: LOCKED_STATUS },
        );
      }
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    try {
      await resetLoginFailures(customer.id);
    } catch (err) {
      // F-321: a concurrent failed attempt from elsewhere locked the
      // account in the gap between the isLocked() check above and this
      // password-verified reset — see resetLoginFailures's doc comment.
      // No session is issued; report the same 423 an ordinary locked
      // attempt gets instead of falling through to the generic 500 below.
      if (err instanceof AccountLockedError) {
        return NextResponse.json(
          { error: "Account temporarily locked. Try again later." },
          { status: LOCKED_STATUS },
        );
      }
      throw err;
    }

    // F-037: only claim guest orders placed under this email once the
    // account has proven it owns that address (emailVerifiedAt set) —
    // logging in only proves the password, not that the registrant is who
    // they say they are. Verified accounts still benefit here: checking
    // out logged-out (expired session, another device, a private window)
    // leaves Order.customerId null even though the account exists, and
    // verify-email's own claim only ever covers orders placed before
    // verification. Best-effort: an unclaimed order is recoverable on the
    // next sign-in, a rejected sign-in isn't.
    if (customer.emailVerifiedAt) {
      try {
        await linkGuestOrdersToCustomer(customer.id, customer.email);
      } catch {
        // Intentionally swallowed — see above.
      }
    }

    await createCustomerSession({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      sessionVersion: customer.sessionVersion,
    });

    return NextResponse.json({
      customer: { id: customer.id, email: customer.email, name: customer.name },
    });
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
