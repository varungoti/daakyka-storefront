import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { createCustomerSession } from "@/lib/customer-auth/session";
import { hashPassword } from "@/lib/customer-auth/password";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { sendVerificationEmail } from "@/lib/customer-auth/mailer";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { identityRateLimitOrResponse } from "@/lib/security/rate-limit";
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

  // F-322: keyed on IP+email (plus a loose per-IP backstop) rather than
  // IP alone — many independent shoppers registering from one shared
  // network (hospital Wi-Fi) must not lock each other out of sign-up.
  const limited = await identityRateLimitOrResponse(request, "account-register", 5, 60_000, {
    identity: email,
    failClosed: true,
  });
  if (limited) return limited;

  try {
    const existing = await db.customer.findUnique({ where: { email } });
    if (existing) {
      // F-042: this route logs the new account in immediately on success
      // (see the module comment above), so a genuinely non-enumerating
      // response was never achievable here — success and failure can
      // never look the same when one of them also sets a session cookie.
      // Given that, say so plainly (Shopify does the same) and point the
      // shopper at the accounts that already exist for common cases this
      // hits often: a returning guest buyer, or a colleague sharing one
      // hospital procurement mailbox. `code` lets the form show real
      // sign-in/reset links instead of a dead-end message. Status stays
      // 400 (not switched to 409) so this remains the same status class
      // existing callers/tests already branch on.
      return NextResponse.json(
        { error: "An account with this email already exists.", code: "EMAIL_TAKEN" },
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

    // F-037: guest orders are claimed only once this email is proven
    // (verifyEmailToken, once the link below is clicked), never on bare
    // registration — typing someone else's address is not proof of
    // ownership. See claim-guest-orders.ts for the claim itself.

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
  } catch (error) {
    // F-042: two concurrent registrations for the same email race past the
    // findUnique check above — the unique constraint on Customer.email is
    // what actually decides it, and the loser must get the same "already
    // exists" response, not a generic 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists.", code: "EMAIL_TAKEN" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
