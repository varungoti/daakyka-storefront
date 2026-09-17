import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { customerAddressSchema } from "@/lib/validation/schemas";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const addresses = await db.customerAddress.findMany({
    where: { customerId: session.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ addresses });
}

export async function POST(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const parsed = customerAddressSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (parsed.data.isDefault) {
      await db.customerAddress.updateMany({
        where: { customerId: session.id },
        data: { isDefault: false },
      });
    }

    // customerId always comes from the session, never the request body —
    // a client cannot create an address under someone else's account.
    const address = await db.customerAddress.create({
      data: { ...parsed.data, customerId: session.id },
    });

    return NextResponse.json({ address }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create address" }, { status: 500 });
  }
}
