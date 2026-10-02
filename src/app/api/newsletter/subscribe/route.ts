import { NextResponse } from "next/server";
import { subscribeToNewsletter } from "@/lib/engagement/newsletter";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { newsletterSchema } from "@/lib/validation/schemas";
import { isHoneypotTripped } from "@/lib/validation/honeypot";

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "newsletter", 10, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    // F-050 fix: this response body is now identical for every address in
    // every state (new, already-subscribed, previously-unsubscribed) — it
    // used to vary the message and echo back the subscriber's stable `id`,
    // which let anyone probe whether a given address is a confirmed
    // subscriber. See subscribeToNewsletter's doc comment for the matching
    // consent fix.
    //
    // F-086: the message itself used to say "Check your inbox to confirm",
    // which is untrue for an address that is already subscribed (no email is
    // sent) — but saying "you're already subscribed" is exactly the oracle F-050
    // closed. It is worded so it is true for every address instead.
    const CONFIRMATION_RESPONSE = {
      ok: true,
      message: "If this address isn't already subscribed, a confirmation link is on its way — check your inbox.",
    } as const;

    if (isHoneypotTripped(bodyResult.data, "newsletter")) {
      return NextResponse.json(CONFIRMATION_RESPONSE);
    }

    const parsed = newsletterSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email or missing consent" }, { status: 400 });
    }

    // engagement_compliance: double opt-in — this only creates an
    // unconfirmed subscriber and sends a confirmation email; it does NOT
    // enroll in any journey. Enrollment happens in
    // GET /api/newsletter/confirm once the link is actually clicked.
    await subscribeToNewsletter({
      email: parsed.data.email,
      source: parsed.data.source,
    });

    return NextResponse.json(CONFIRMATION_RESPONSE);
  } catch {
    return NextResponse.json({ error: "Subscription failed" }, { status: 500 });
  }
}
