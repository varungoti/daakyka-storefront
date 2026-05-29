import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { newsletterSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "newsletter", 10, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = newsletterSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email or missing consent" }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();
    const subscriber = await db.newsletterSubscriber.upsert({
      where: { email },
      update: { source: parsed.data.source ?? "footer", consentGiven: true },
      create: {
        email,
        source: parsed.data.source ?? "footer",
        consentGiven: true,
      },
    });

    await triggerJourneys("newsletter_signup", { email });

    return NextResponse.json({ id: subscriber.id, message: "Subscribed successfully" });
  } catch {
    return NextResponse.json({ error: "Subscription failed" }, { status: 500 });
  }
}
