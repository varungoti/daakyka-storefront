import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractRequestAttribution } from "@/lib/analytics/attribution";
import { notifyNewEnquiry } from "@/lib/admin/new-enquiry-alert";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { subscribeToNewsletter } from "@/lib/engagement/newsletter";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { bulkOrderSchema } from "@/lib/validation/schemas";
import { isHoneypotTripped } from "@/lib/validation/honeypot";

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "bulk-orders", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    if (isHoneypotTripped(bodyResult.data)) {
      return NextResponse.json({ id: "ok", message: "Enquiry submitted successfully" });
    }

    const parsed = bulkOrderSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // F-071: marketingOptIn is real marketing consent, kept out of
    // BulkOrderLead entirely (that model has no such column, and
    // consentGiven there means enquiry-contact consent only — see
    // segment-resolver.ts). It's handled below via the newsletter's own
    // double opt-in, never persisted on the lead itself.
    const { marketingOptIn, ...leadData } = parsed.data;

    // F-318: best-effort attribution (query params / Referer header) — see
    // src/lib/analytics/attribution.ts.
    const attribution = extractRequestAttribution(request);
    const lead = await db.bulkOrderLead.create({
      data: { ...leadData, ...attribution },
    });

    if (marketingOptIn) {
      try {
        await subscribeToNewsletter({ email: lead.email, source: "bulk-order" });
      } catch {
        // Best-effort — a failed opt-in must never fail the enquiry itself.
      }
    }

    // F-049: instant owner alert. Previously the only alert for a bulk
    // lead was the seeded journey's "Admin notification" step, which
    // waits for the once-daily /api/cron/journeys run (up to ~24h late)
    // — see notifyNewEnquiry's doc comment. Best-effort; never blocks the
    // response to the visitor.
    await notifyNewEnquiry({
      kind: "bulk-order",
      id: lead.id,
      name: lead.contactPerson,
      organization: lead.organization,
      messageSnippet: lead.notes,
    });

    await triggerJourneys("bulk_lead_created", {
      email: lead.email,
      phone: lead.phone,
      contactName: lead.contactPerson,
      organization: lead.organization,
    });

    return NextResponse.json({ id: lead.id, message: "Enquiry submitted successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to submit enquiry" }, { status: 500 });
  }
}
