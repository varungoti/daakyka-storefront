import { NextResponse } from "next/server";
import {
  deleteAddressAndPromoteDefault,
  loadOwnAddress,
  updateAddressForCustomer,
} from "@/lib/customer-auth/addresses";
import { getCustomerSession } from "@/lib/customer-auth/session";
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

    // F-134: clearing every other default and setting this one happen in
    // the same transaction as the update itself (see updateAddressForCustomer).
    const address = await updateAddressForCustomer(id, session.id, parsed.data);

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

  // See deleteAddressAndPromoteDefault's doc comment (F-134): deleting the
  // default used to promote nothing, so "default address" silently
  // stopped meaning anything once it was removed.
  await deleteAddressAndPromoteDefault(id, session.id, existing.isDefault);

  return NextResponse.json({ ok: true });
}
