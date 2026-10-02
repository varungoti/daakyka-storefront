import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { getMarketingStatus, setMarketingPreference } from "@/lib/privacy/preferences";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { identityRateLimitOrResponse } from "@/lib/security/rate-limit";

const marketingSchema = z.object({ subscribed: z.boolean() });

async function customerEmail(customerId: string): Promise<string | null> {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  return customer?.email ?? null;
}

/** F-315: whether the signed-in customer's address receives marketing email. */
export async function GET() {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = await customerEmail(session.id);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ status: await getMarketingStatus(email) });
}

/**
 * F-315: turn marketing email off (immediate) or on (double opt-in — we send
 * a confirmation link first, exactly like the footer form). Operates only on
 * the session's own address.
 */
export async function PUT(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await identityRateLimitOrResponse(request, "account-marketing", 10, 60_000, { identity: session.id });
  if (limited) return limited;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = marketingSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = await customerEmail(session.id);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await setMarketingPreference(email, parsed.data.subscribed);
  return NextResponse.json({ status });
}
