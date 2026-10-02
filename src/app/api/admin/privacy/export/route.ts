import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { exportPersonalData } from "@/lib/privacy/export";
import { PrivacySubjectError, resolveSubject, subjectReference } from "@/lib/privacy/subject";
import { readJsonBody } from "@/lib/security/parse-json-body";

const subjectSchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(7).max(30).optional(),
  })
  .refine((value) => Boolean(value.email || value.phone), { message: "An email address or a phone number is required" });

/**
 * F-315: export for a person who has no Customer account — a guest buyer, a
 * contact-form enquirer, a bulk lead, a newsletter subscriber — looked up by
 * email (and optionally phone). POST, not GET, so the address never travels
 * in a URL. If the email does belong to a customer account its data is
 * included too.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("privacy:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = subjectSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const subject = await resolveSubject(parsed.data, { trust: "admin" });
    const data = await exportPersonalData(parsed.data, { audience: "admin" });

    await logAuditEvent({
      userId: session.id,
      action: "export",
      entity: subject.customerId ? "customer" : "personal_data",
      entityId: subject.customerId ?? subjectReference(subject),
      metadata: { source: "admin" },
    }).catch(() => undefined);

    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="personal-data-export.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PrivacySubjectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
