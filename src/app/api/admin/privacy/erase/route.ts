import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { ErasureBlockedError, erasePersonalData } from "@/lib/privacy/erase";
import { PrivacySubjectError } from "@/lib/privacy/subject";
import { readJsonBody } from "@/lib/security/parse-json-body";

const eraseSchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    /** Must equal the email (or, for a phone-only request, the phone) typed again. */
    confirm: z.string().trim().min(1).max(254),
    includeOpenOrders: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.email || value.phone), { message: "An email address or a phone number is required" });

/**
 * F-315: "Erase personal data" for a person looked up by email / phone — a
 * guest buyer, enquirer, bulk lead or subscriber, plus their account if the
 * email has one. Same scope and rules as the per-customer erase (see
 * src/lib/privacy/erase.ts), and the same typed confirmation.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("privacy:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = eraseSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const expected = (parsed.data.email ?? parsed.data.phone ?? "").toLowerCase();
  if (parsed.data.confirm.toLowerCase() !== expected) {
    return NextResponse.json({ error: "What you typed does not match." }, { status: 400 });
  }

  try {
    const report = await erasePersonalData(
      { email: parsed.data.email, phone: parsed.data.phone },
      { actorUserId: session.id, source: "admin", includeOpenOrders: parsed.data.includeOpenOrders },
    );
    return NextResponse.json({ ok: true, counts: report.counts });
  } catch (err) {
    if (err instanceof ErasureBlockedError) {
      return NextResponse.json({ error: err.message, orders: err.orderNumbers }, { status: 409 });
    }
    if (err instanceof PrivacySubjectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
