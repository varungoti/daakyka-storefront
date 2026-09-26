import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { commitProductImport, dryRunProductImport, ImportSkuConflictError, ImportValidationError } from "@/lib/catalog/product-import";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB is generous for a CSV of variant rows

/**
 * Product CSV import — multipart/form-data (consistent with
 * src/app/api/admin/media/route.ts's upload endpoint) rather than a JSON
 * body, since the payload is a file the admin picks from disk.
 *
 * `mode=dryRun` validates and returns per-row results without writing.
 * `mode=commit` re-validates (never trusts a stale client-side dry run)
 * and writes in a single transaction; it 409s with the same per-row
 * detail if anything fails validation at commit time.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const limited = await rateLimitOrResponse(request, "admin-products-import", 10, 60_000);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Content-Type must be multipart/form-data" }, { status: 415 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 413 });
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
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 413 });
  }

  const modeRaw = form.get("mode");
  const mode = modeRaw === "commit" ? "commit" : "dryRun";
  const generateImagesRaw = form.get("generateImages");
  const generateImages = generateImagesRaw === "yes" || generateImagesRaw === "true";

  const csvText = await file.text();

  if (mode === "dryRun") {
    const result = await dryRunProductImport(csvText);
    return NextResponse.json(result);
  }

  try {
    const result = await commitProductImport(csvText, session.id, { generateImages });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportValidationError) {
      return NextResponse.json({ error: err.message, rows: err.rows }, { status: 409 });
    }
    if (err instanceof ImportSkuConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // F-181: a row combination the dry run's own checks don't (or can't —
    // e.g. two admins committing overlapping files at once) catch used to
    // reach Postgres's unique constraints (variant SKU, or
    // @@unique([productId, size, color])) and come back as a bare 500 with
    // an empty body — the UI's only fallback was the generic "Commit
    // failed." with no indication of what to fix. The dry-run validation
    // above (validateImportRows: slug/hex/length/duplicate checks) should
    // catch this ahead of time now, but this stays as the last line of
    // defense for whatever it doesn't.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2003")) {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : typeof err.meta?.target === "string" ? err.meta.target : "a field";
      return NextResponse.json(
        { error: `Import failed: a value conflicts with an existing record (${target}). Check for duplicate SKUs or size/colour combinations.` },
        { status: 409 },
      );
    }
    console.error("[admin.products.import] commit failed unexpectedly", err);
    return NextResponse.json({ error: "Import failed unexpectedly" }, { status: 500 });
  }
}
