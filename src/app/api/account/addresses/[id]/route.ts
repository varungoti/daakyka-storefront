import { NextResponse } from "next/server";
import { loadOwnAddress } from "@/lib/customer-auth/addresses";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { customerAddressUpdateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await loadOwnAddress(id, session.id);
  if (!existing) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const parsed = customerAddressUpdateSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (parsed.data.isDefault) {
      await db.customerAddress.updateMany({
        where: { customerId: session.id, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const address = await db.customerAddress.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json({ address });
  } catch {
    return NextResponse.json({ error: "Failed to update address" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await loadOwnAddress(id, session.id);
  if (!existing) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  await db.customerAddress.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
