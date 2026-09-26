import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

/**
 * F-049: /admin/contact-enquiries was entirely read-only — every enquiry
 * stayed "NEW" forever, with no way to record it as followed up. Mirrors
 * src/app/api/admin/bulk-orders/[id]/route.ts's PATCH, gated by the same
 * `bulk-orders:manage` permission the page itself already checks.
 * `ContactEnquiry.status` is a free-form `String` column (no schema
 * change needed), so this is the validation boundary for it.
 */
const updateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CLOSED"]),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("bulk-orders:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = updateSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let enquiry;
  try {
    enquiry = await db.contactEnquiry.update({
      where: { id },
      data: { status: parsed.data.status },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
    }
    throw err;
  }

  await logAuditEvent({
    userId: session.id,
    action: "update_status",
    entity: "contact_enquiry",
    entityId: id,
    metadata: { status: parsed.data.status },
  });

  return NextResponse.json(enquiry);
}
