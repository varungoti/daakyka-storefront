import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  DiscountNotFoundForAdminError,
  DuplicateDiscountCodeError,
  getDiscountForAdmin,
  updateDiscount,
} from "@/lib/discounts";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { discountUpdateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("offers:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const discount = await getDiscountForAdmin(id);
    return NextResponse.json(discount);
  } catch (err) {
    if (err instanceof DiscountNotFoundForAdminError) {
      return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    }
    throw err;
  }
}

// No DELETE: discount codes are created/edited/deactivated (the `active`
// flag), never hard-deleted — a redeemed code's history (DiscountRedemption
// rows, and Order.discountCode's snapshot) needs to stay meaningful for
// past orders. See src/lib/discounts/index.ts's module doc comment.
export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("offers:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = discountUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const discount = await updateDiscount(id, parsed.data, session!.id);
    return NextResponse.json(discount);
  } catch (err) {
    if (err instanceof DiscountNotFoundForAdminError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    }
    if (err instanceof DuplicateDiscountCodeError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
