import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { createOffer, listOffersForAdmin } from "@/lib/offers";
import { offerSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("offers:manage");
  if (error) return error;
  const offers = await listOffersForAdmin();
  return NextResponse.json(offers);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("offers:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = offerSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const offer = await createOffer(parsed.data, session!.id);
  return NextResponse.json(offer, { status: 201 });
}
