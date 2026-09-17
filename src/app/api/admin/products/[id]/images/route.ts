import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { addProductImage, ProductImageNotFoundError, ProductNotFoundError } from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const addImageSchema = z.object({
  mediaAssetId: z.string().trim().min(1),
  color: z.string().trim().max(60).optional().nullable(),
  alt: z.string().trim().max(300).optional().nullable(),
});

export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = addImageSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const image = await addProductImage(id, parsed.data.mediaAssetId, { color: parsed.data.color, alt: parsed.data.alt }, session.id);
    return NextResponse.json({ image }, { status: 201 });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (err instanceof ProductImageNotFoundError) {
      return NextResponse.json({ error: "Media asset not found" }, { status: 400 });
    }
    throw err;
  }
}
