import { NextResponse } from "next/server";
import { createAddressForCustomer } from "@/lib/customer-auth/addresses";
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

    // customerId always comes from the session, never the request body —
    // a client cannot create an address under someone else's account. See
    // createAddressForCustomer's doc comment (F-134) for why the first
    // address always becomes default.
    const address = await createAddressForCustomer(session.id, parsed.data);

    return NextResponse.json({ address }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create address" }, { status: 500 });
  }
}
