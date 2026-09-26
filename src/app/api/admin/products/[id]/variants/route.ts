import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { DuplicateVariantKeyError, DuplicateVariantSkuError } from "@/lib/catalog/product-validation";
import {
  ProductNotFoundError,
  ProductSlugConflictError,
  replaceVariants,
  VariantOwnershipError,
  VariantStockConflictError,
  variantsInputSchema,
} from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** F-023/F-336: syncs the admin form's variant grid against the DB with a
 * per-row diff (see replaceVariants' own doc comment) rather than
 * replacing the whole table — each row is matched to an existing one by
 * `id`, or by (size,color) for a new row, so variant ids/order
 * history/back-in-stock signups survive an ordinary save. */
export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = variantsInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const variants = await replaceVariants(id, parsed.data.variants, session.id);
    return NextResponse.json({ success: true, variants });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (err instanceof VariantOwnershipError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof DuplicateVariantKeyError || err instanceof DuplicateVariantSkuError || err instanceof ProductSlugConflictError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof VariantStockConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // F-336: two variant saves racing each other (e.g. a SKU or
    // size/colour swap that collides mid-transaction — see
    // replaceVariants' doc comment) previously surfaced as an unhandled
    // P2002 -> 500. A concurrent-write conflict is a 409, not a server
    // error: the admin can reload and retry.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Another save just changed one of these variants — reload and try again" }, { status: 409 });
    }
    throw err;
  }
}
