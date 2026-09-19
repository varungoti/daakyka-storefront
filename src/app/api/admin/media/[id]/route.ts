import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  deleteUnattachedMediaAsset,
  MediaAssetAttachedError,
  MediaAssetInUseError,
  MediaAssetNotFoundError,
} from "@/lib/media/store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Deletes a `MediaAsset` that nothing references yet — see
 * `deleteUnattachedMediaAsset` (src/lib/media/store.ts) for the full
 * rationale. Used by the new-product form's staging gallery
 * (src/components/admin/staged-product-image-gallery.tsx) when an admin
 * removes a photo they uploaded/generated before ever saving the product
 * (F-04, docs/audit-2026-09-19/admin-ux.md); nothing else in the admin UI
 * currently calls this route, since every other "remove image" action is
 * detaching an already-attached image, which stays on
 * `DELETE /api/admin/products/[id]/images/[imageId]` by design (see the
 * error message MediaAssetAttachedError carries).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("media:manage");
  if (error) return error;

  const { id } = await params;

  try {
    await deleteUnattachedMediaAsset(id);

    await logAuditEvent({
      userId: session.id,
      action: "delete",
      entity: "media_asset",
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof MediaAssetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof MediaAssetAttachedError || err instanceof MediaAssetInUseError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
