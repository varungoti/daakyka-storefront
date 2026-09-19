import { NextResponse } from "next/server";
import { resendVerificationEmail } from "@/lib/customer-auth/resend-verification";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { checkRateLimit, rateLimitOrResponse } from "@/lib/security/rate-limit";
import { customerForgotPasswordSchema } from "@/lib/validation/schemas";
import { isHoneypotTripped } from "@/lib/validation/honeypot";

/**
 * F3 fix (docs/audit-2026-09-19/storefront-ux.md): "resend verification
 * email" — previously there was no route or UI for this at all, so a
 * customer whose verification email was lost, expired, or (see F7)
 * silently dropped because Brevo wasn't configured could never write a
 * review. Deliberately mirrors POST /api/account/forgot-password's shape
 * exactly: same Zod schema (both just need a valid email — reused as-is
 * rather than adding a near-duplicate to src/lib/validation/schemas.ts),
 * same honeypot handling, and the same "always the exact same response"
 * anti-enumeration contract — see resendVerificationEmail's doc comment
 * (src/lib/customer-auth/resend-verification.ts) for why the response
 * never varies with whether the address is registered or already
 * verified.
 */

const GENERIC_RESPONSE = {
  message: "If that email needs verifying, a new verification link is on its way.",
};

// Per-account limiter on top of the standard per-IP rateLimitOrResponse
// below: calls checkRateLimit directly (the same DB-backed helper
// rateLimitOrResponse itself uses) with a key derived from the submitted
// email instead of the caller's IP, so repeatedly resending to one address
// is bounded regardless of how many different IPs ask. This doesn't add
// any new rate-limiting machinery, and doesn't leak account existence: the
// bucket key is just the raw submitted string, consumed identically
// whether or not it turns out to belong to a real, unverified customer.
const PER_ACCOUNT_LIMIT = 3;
const PER_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "account-resend-verification", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    if (isHoneypotTripped(bodyResult.data)) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const parsed = customerForgotPasswordSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      // Same as forgot-password: never a distinct 400 here either, so a
      // malformed payload can't be used to learn anything a valid one
      // couldn't.
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const email = parsed.data.email.toLowerCase();
    const accountLimit = await checkRateLimit(
      `account-resend-verification:${email}`,
      PER_ACCOUNT_LIMIT,
      PER_ACCOUNT_WINDOW_MS,
    );
    if (!accountLimit.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(accountLimit.retryAfter) } },
      );
    }

    const origin = new URL(request.url).origin;
    await resendVerificationEmail(email, origin);

    return NextResponse.json(GENERIC_RESPONSE);
  } catch {
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
