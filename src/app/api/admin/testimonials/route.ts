import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { testimonialSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;
  const testimonials = await db.testimonialRecord.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(testimonials);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = testimonialSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const testimonial = await db.testimonialRecord.create({ data: parsed.data });

  await logAuditEvent({
    userId: session!.id,
    action: "create",
    entity: "testimonial",
    entityId: testimonial.id,
  });

  return NextResponse.json(testimonial, { status: 201 });
}
