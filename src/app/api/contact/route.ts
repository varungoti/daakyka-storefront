import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  organization: z.string().optional(),
  type: z.enum(["GENERAL", "BULK_ORDER", "INSTITUTIONAL", "SUPPORT"]).default("GENERAL"),
  message: z.string().min(10),
});

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "contact", 5, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = contactSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const enquiry = await db.contactEnquiry.create({ data: parsed.data });

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
