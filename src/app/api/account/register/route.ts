import { NextResponse } from "next/server";
import { createCustomerSession } from "@/lib/customer-auth/session";
import { hashPassword } from "@/lib/customer-auth/password";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { sendVerificationEmail } from "@/lib/customer-auth/mailer";
import { db } from "@/lib/db";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { customerRegisterSchema } from "@/lib/validation/schemas";
import { isHoneypotTripped } from "@/lib/validation/honeypot";

// UX choice (documented in the D1 report): we log the customer in
// immediately on registration rather than requiring email verification
// first. emailVerifiedAt stays null until /verify-email is hit; anything
// that should be gated on verification (writing a review, in D2) checks
// that field at the point of use instead of blocking account creation
// itself. This avoids a dead-end "check your email, come back and log in"
// step for the common case, while still tracking verification status.
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "account-register", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    if (isHoneypotTripped(bodyResult.data)) {
      // Fake success: give the bot no signal it was caught.
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const parsed = customerRegisterSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await db.customer.findUnique({ where: { email } });
    if (existing) {
      // Don't reveal whether the account exists via a distinct message —
      // treat it the same class of information leak as forgot-password.
      return NextResponse.json(
        { error: "Could not create account with those details" },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const customer = await db.customer.create({
      data: {
        email,
        name: parsed.data.name,
        phone: parsed.data.phone,
        passwordHash,
      },
    });

    // Attach any orders this person placed as a guest with the same
    // address, so "My orders" isn't empty for a returning shopper who
    // only now created an account. Never fails registration: an
    // unclaimed order is recoverable later, a failed signup isn't.
    try {
      await linkGuestOrdersToCustomer(customer.id, customer.email);
    } catch {
      // Intentionally swallowed — see above.
    }

    const { raw } = await issueCustomerToken(customer.id, "VERIFY");
    const origin = new URL(request.url).origin;
    const verifyLink = `${origin}/account/verify-email?token=${raw}`;
    await sendVerificationEmail(customer.email, verifyLink);

    await createCustomerSession({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      sessionVersion: customer.sessionVersion,
    });

    return NextResponse.json(
      {
        customer: { id: customer.id, email: customer.email, name: customer.name },
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
