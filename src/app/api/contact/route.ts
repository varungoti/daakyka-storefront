import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractRequestAttribution } from "@/lib/analytics/attribution";
import { notifyNewEnquiry } from "@/lib/admin/new-enquiry-alert";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { isHoneypotTripped } from "@/lib/validation/honeypot";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().min(2, "Please enter your full name").max(120),
  email: z.string().email("Enter a valid email address").max(254),
  phone: z.string().max(32).optional(),
  organization: z.string().max(200).optional(),
  type: z.enum(["GENERAL", "BULK_ORDER", "INSTITUTIONAL", "SUPPORT"]).default("GENERAL"),
  message: z.string().min(10, "Please add a few more details (at least 10 characters)").max(5000),
});

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "contact", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    if (isHoneypotTripped(bodyResult.data)) {
      // Fake success, no DB write: gives a bot no signal it was caught.
      return NextResponse.json({ id: "ok", message: "Enquiry received" });
    }

    const parsed = contactSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      // F-152: surface per-field messages the same way /api/bulk-orders
      // already does — the form used to render only "Validation failed"
      // for e.g. a 9-character message, indistinguishable from a server
      // fault.
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // F-318: best-effort attribution (query params / Referer header) — see
    // src/lib/analytics/attribution.ts.
    const attribution = extractRequestAttribution(request);
    const enquiry = await db.contactEnquiry.create({
      data: { ...parsed.data, ...attribution },
    });

    // F-049: instant owner alert for every enquiry type — previously none
    // of them raised any alert at all. Best-effort; never blocks the
    // response to the visitor.
    await notifyNewEnquiry({
      kind: "contact",
      id: enquiry.id,
      name: enquiry.name,
      organization: enquiry.organization,
      messageSnippet: enquiry.message,
    });

    if (parsed.data.type === "BULK_ORDER" || parsed.data.type === "INSTITUTIONAL") {
      await triggerJourneys("bulk_lead_created", {
        email: enquiry.email,
        phone: enquiry.phone ?? undefined,
        contactName: enquiry.name,
        organization: enquiry.organization ?? undefined,
      });
    }

    return NextResponse.json({ id: enquiry.id, message: "Enquiry received" });
  } catch {
    return NextResponse.json({ error: "Failed to submit enquiry" }, { status: 500 });
  }
}
