import { NextResponse } from "next/server";
import { MediaSource, MediaUsage } from "@/generated/prisma/client";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { saveMediaAsset, StorageNotConfiguredForMediaError } from "@/lib/media/store";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { reviewSubmissionGate } from "@/lib/reviews/eligibility";

/**
 * Phase D2: uploads a single review photo, returning its MediaAsset id to
 * attach via `photoAssetIds` on `POST /api/reviews`.
 *
 * Design decision (documented per the phase brief): this mirrors
 * src/app/api/admin/media/route.ts's POST handler almost exactly (same
 * multipart validation, same saveMediaAsset() call) but gated on a
 * CUSTOMER session instead of an admin permission, fixed to
 * `usage=REVIEW`, and a tighter 5MB/file limit. It accepts one file per
 * request rather than up to 3 in one call — simpler to mirror the existing
 * single-file route exactly, and the client just calls this up to 3 times
 * (REVIEW_MAX_PHOTOS) for a review with multiple photos.
 */
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getCustomerSession();
  const gate = reviewSubmissionGate(session);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const limited = await rateLimitOrResponse(request, "reviews-photo-upload", 15, 60_000);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Content-Type must be multipart/form-data" }, { status: 415 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type — use JPEG, PNG, WebP, or AVIF" },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const asset = await saveMediaAsset({
      buffer,
      usage: MediaUsage.REVIEW,
      source: MediaSource.UPLOAD,
      alt: "Customer review photo",
    });

    return NextResponse.json({ id: asset.id, url: asset.url }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageNotConfiguredForMediaError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}
