import { NextResponse } from "next/server";
import { MediaSource, MediaUsage } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { saveMediaAsset, StorageNotConfiguredForMediaError } from "@/lib/media/store";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MEDIA_USAGE_VALUES = new Set<string>(Object.values(MediaUsage));
const MAX_LIST_LIMIT = 60;

/**
 * Lists recent media assets, optionally filtered by usage — backs the
 * simple "pick an existing image" picker used by the categories admin
 * form (Phase B2). The full media library grid (filters, replace,
 * regenerate) is a separate, later admin screen; this is intentionally
 * minimal.
 */
export async function GET(request: Request) {
  const { error } = await requireAdminPermission("media:manage");
  if (error) return error;

  const url = new URL(request.url);
  const usageParam = url.searchParams.get("usage");
  if (usageParam && !MEDIA_USAGE_VALUES.has(usageParam)) {
    return NextResponse.json(
      { error: `usage must be one of: ${[...MEDIA_USAGE_VALUES].join(", ")}` },
      { status: 400 },
    );
  }

  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIST_LIMIT) : 24;

  const assets = await db.mediaAsset.findMany({
    where: usageParam ? { usage: usageParam as MediaUsage } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ assets });
}

/**
 * Registers a new uploaded media asset.
 *
 * Design choice: the client uploads the file directly to this route as
 * multipart/form-data, which processes it with `sharp` (EXIF strip,
 * resize, WebP re-encode — see src/lib/media/process-image.ts) before it
 * ever reaches R2. A presigned-URL flow (browser uploads straight to R2)
 * would bypass the server entirely and store the raw, unprocessed
 * original — this app always wants the normalized WebP version, and only
 * a server can run sharp, so the bytes must transit here regardless.
 * `getPresignedUploadUrl` still exists as a complete, tested building
 * block in src/lib/storage/r2.ts (e.g. for a future very-large-file path)
 * but isn't exposed as its own admin API route for that reason.
 *
 * `readJsonBody` isn't used here — it hard-requires application/json — so
 * this route does its own Content-Type and size checks up front instead.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("media:manage");
  if (error) return error;

  const limited = rateLimitOrResponse(request, "admin-media-upload", 30, 60_000);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 415 },
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 413 });
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
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 413 });
  }

  const usageRaw = form.get("usage");
  const usage = typeof usageRaw === "string" ? usageRaw : "";
  if (!MEDIA_USAGE_VALUES.has(usage)) {
    return NextResponse.json(
      { error: `usage must be one of: ${[...MEDIA_USAGE_VALUES].join(", ")}` },
      { status: 400 },
    );
  }

  const altRaw = form.get("alt");
  const alt = typeof altRaw === "string" && altRaw.trim() ? altRaw.trim().slice(0, 300) : undefined;

  const slotRaw = form.get("slot");
  const slot = typeof slotRaw === "string" && slotRaw.trim() ? slotRaw.trim().slice(0, 200) : undefined;

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const asset = await saveMediaAsset({
      buffer,
      usage: usage as MediaUsage,
      source: MediaSource.UPLOAD,
      alt,
      slot,
      createdById: session.id,
    });

    await logAuditEvent({
      userId: session.id,
      action: "create",
      entity: "media_asset",
      entityId: asset.id,
      metadata: { usage, source: "UPLOAD", key: asset.key },
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageNotConfiguredForMediaError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}
