import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  ProductImageNotFoundError,
  ProductNotFoundError,
  reorderProductImages,
  removeProductImage,
  setImageColor,
  updateImageAlt,
} from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string; imageId: string }>;
}

const patchSchema = z.object({
  color: z.string().trim().max(60).optional().nullable(),
  alt: z.string().trim().max(300).optional().nullable(),
  reorder: z.enum(["up", "down"]).optional(),
});

/** A single PATCH covers colour/alt edits and up/down reordering (no
 * separate reorder endpoint — see reorderProductImages doc comment for
 * why up/down swaps were chosen over full drag-and-drop persistence). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id, imageId } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = patchSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    if (parsed.data.reorder) {
      await reorderProductImages(id, imageId, parsed.data.reorder, session.id);
    }
    let image = null;
    if (parsed.data.color !== undefined) {
      image = await setImageColor(imageId, parsed.data.color, session.id);
    }
    if (parsed.data.alt !== undefined) {
      image = await updateImageAlt(imageId, parsed.data.alt, session.id);
    }
    return NextResponse.json({ success: true, image });
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof ProductImageNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { imageId } = await params;
  try {
    await removeProductImage(imageId, session.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ProductImageNotFoundError) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    throw err;
  }
}
