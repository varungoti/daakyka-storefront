import { NextResponse } from "next/server";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/customer-auth/password";
import { createCustomerSession } from "@/lib/customer-auth/session";
import { isLocked, recordFailedLogin, resetLoginFailures } from "@/lib/customer-auth/lockout";
import { db } from "@/lib/db";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { loginSchema } from "@/lib/validation/schemas";

// 423 Locked is used consistently across D1 for "account temporarily
// locked out" (as opposed to 401 for "wrong credentials" and 403 for
// "authenticated but not allowed to touch this resource").
const LOCKED_STATUS = 423;

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "account-login", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = loginSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();
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

    await resetLoginFailures(customer.id);

    // Claim guest orders placed under this email since the account was
    // created: checking out logged-out (expired session, another device, a
    // private window) leaves Order.customerId null even though the account
    // exists, and registration's own claim only ever covers orders placed
    // before signup. Logging in proves this account's password — stronger
    // evidence of owning the address than registering, which only requires
    // typing it — so this adds no trust assumption beyond the one
    // claim-guest-orders.ts documents. Best-effort: an unclaimed order is
    // recoverable on the next sign-in, a rejected sign-in isn't.
    try {
      await linkGuestOrdersToCustomer(customer.id, customer.email);
    } catch {
      // Intentionally swallowed — see above.
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
