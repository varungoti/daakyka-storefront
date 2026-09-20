import { NextResponse } from "next/server";
import { MediaSource, MediaUsage } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { buildMediaAssetWhere, InvalidMediaQueryError, parseMediaAssetQuery } from "@/lib/media/query";
import { saveMediaAsset, StorageNotConfiguredForMediaError } from "@/lib/media/store";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MEDIA_USAGE_VALUES = new Set<string>(Object.values(MediaUsage));

/**
 * Lists media assets — filterable by usage, source (upload vs AI), a free
 * text search (alt/prompt/key), and a createdAt date range (see
 * src/lib/media/query.ts for the pure parsing/query-building this defers
 * to), with "where is this used" info per asset.
 *
 * Backs two callers: the categories admin form's lightweight "pick a
 * recent image" flow (Phase B2, just `usage` + `limit`), and the general
 * F-07 media library browser (src/components/admin/media-library-browser.tsx,
 * release-hardening) that any image field — the product gallery
 * especially — can open to reuse an existing asset instead of re-uploading
 * it. Picking an existing asset never touches R2: callers just reference
 * the returned `id` (e.g. `POST /api/admin/products/[id]/images` with
 * `mediaAssetId`), so nothing here duplicates the underlying object.
 */
export async function GET(request: Request) {
  const { error } = await requireAdminPermission("media:manage");
  if (error) return error;

  const url = new URL(request.url);
  let query;
  try {
    query = parseMediaAssetQuery({
      usage: url.searchParams.get("usage"),
      source: url.searchParams.get("source"),
      search: url.searchParams.get("search"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    });
  } catch (err) {
    if (err instanceof InvalidMediaQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const where = buildMediaAssetWhere(query);

  const [rows, total] = await Promise.all([
    db.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      skip: query.offset,
      include: {
        _count: { select: { productImages: true, categories: true } },
        productImages: {
          take: 3,
          distinct: ["productId"],
          select: { product: { select: { id: true, name: true, slug: true } } },
        },
      },
    }),
    db.mediaAsset.count({ where }),
  ]);

  // F-07: "where is each asset used" — a manifest/site slot, a category
  // tile, and/or a handful of products (a sample, not every product, so
  // this stays cheap for a heavily-reused photo) — so an admin browsing
  // the library can tell a fresh upload apart from one already in use.
  const assets = rows.map((row) => {
    const { _count, productImages, ...asset } = row;
    return {
      ...asset,
      usageInfo: {
        slot: row.slot,
        categoryCount: _count.categories,
        productCount: _count.productImages,
        sampleProductNames: productImages.map((pi) => pi.product.name),
      },
    };
  });

  return NextResponse.json({ assets, total, limit: query.limit, offset: query.offset });
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

  const limited = await rateLimitOrResponse(request, "admin-media-upload", 30, 60_000);
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
