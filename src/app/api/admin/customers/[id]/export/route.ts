import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { exportPersonalData } from "@/lib/privacy/export";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * F-315: "Export customer data" — everything held about one customer (and
 * about their email address in the tables that have no Customer link), as a
 * JSON download. For answering an access request without SQL. The audit row
 * records that an export happened, never its contents.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("privacy:manage");
  if (error) return error;

  const { id } = await params;
  const customer = await db.customer.findUnique({ where: { id }, select: { id: true } });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const data = await exportPersonalData({ customerId: customer.id }, { audience: "admin" });

  await logAuditEvent({
    userId: session.id,
    action: "export",
    entity: "customer",
    entityId: customer.id,
    metadata: { source: "admin" },
  }).catch(() => undefined);

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="customer-${customer.id}-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
