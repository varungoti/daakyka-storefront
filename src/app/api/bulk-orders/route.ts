import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { bulkOrderSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "bulk-orders", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = bulkOrderSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const lead = await db.bulkOrderLead.create({
      data: parsed.data,
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
