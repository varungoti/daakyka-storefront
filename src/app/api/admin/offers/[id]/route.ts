import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { deleteOffer, getOfferForAdmin, OfferNotFoundError, updateOffer } from "@/lib/offers";
import { offerUpdateSchema } from "@/lib/validation/schemas";

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
    const offer = await getOfferForAdmin(id);
    return NextResponse.json(offer);
  } catch (err) {
    if (err instanceof OfferNotFoundError) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("offers:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = offerUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const offer = await updateOffer(id, parsed.data, session!.id);
    return NextResponse.json(offer);
  } catch (err) {
    if (err instanceof OfferNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("offers:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteOffer(id, session!.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof OfferNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    throw err;
  }
}
