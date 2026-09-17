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

    if (isHoneypotTripped(bodyResult.data)) {
      return NextResponse.json({ id: "ok", message: "Subscribed successfully" });
    }

    const parsed = newsletterSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email or missing consent" }, { status: 400 });
    }

    // engagement_compliance: double opt-in — this only creates an
    // unconfirmed subscriber and sends a confirmation email; it does NOT
    // enroll in any journey. Enrollment happens in
    // GET /api/newsletter/confirm once the link is actually clicked.
    const { id, alreadyConfirmed } = await subscribeToNewsletter({
      email: parsed.data.email,
      source: parsed.data.source,
    });

    return NextResponse.json({
      id,
      message: alreadyConfirmed
        ? "You're already subscribed."
        : "Check your inbox to confirm your subscription.",
    });
  } catch {
    return NextResponse.json({ error: "Subscription failed" }, { status: 500 });
  }
}
