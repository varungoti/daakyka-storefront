import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { isSlugAvailable } from "@/lib/catalog/products";

/** Live slug-uniqueness check for the admin product form's debounced
 * slug field. `products:view` is enough — this is a read, not a write. */
export async function GET(request: Request) {
  const { error } = await requireAdminPermission("products:view");
  if (error) return error;

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }
  const excludeId = url.searchParams.get("excludeId") ?? undefined;

  const available = await isSlugAvailable(slug, excludeId);
  return NextResponse.json({ available });
}
