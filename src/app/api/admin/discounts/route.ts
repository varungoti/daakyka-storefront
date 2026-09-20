import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { createDiscount, DuplicateDiscountCodeError, listDiscountsForAdmin } from "@/lib/discounts";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { discountSchema } from "@/lib/validation/schemas";

/**
 * Release-hardening F7: admin discount-code CRUD. Gated on `offers:manage`
 * — reused rather than inventing a new permission because discount codes
 * are the same kind of promotions/marketing capability as the existing
 * `OfferRecommendation` entity (see src/lib/offers/index.ts and
 * /admin/offers), and every role that can manage one already makes sense
 * managing the other (MARKETING_ADMIN, STORE_OWNER, SUPER_ADMIN — see
 * src/lib/auth/rbac.ts).
 */
export async function GET() {
  const { error } = await requireAdminPermission("offers:manage");
  if (error) return error;
  const discounts = await listDiscountsForAdmin();
  return NextResponse.json(discounts);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("offers:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = discountSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const discount = await createDiscount(parsed.data, session!.id);
    return NextResponse.json(discount, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateDiscountCodeError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
