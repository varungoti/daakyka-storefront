import { getProductByHandle } from "@/lib/products";
import { getApprovedReviews, type ReviewSort } from "@/lib/reviews";
import { NextResponse } from "next/server";

/**
 * Phase C5: public, read-only pagination/sort for a product's approved
 * reviews, used by the "Load more" control on the product detail page's
 * reviews section (the first page is server-rendered directly via
 * getApprovedReviews). No auth — these are already-moderated, publicly
 * visible reviews; nothing here mutates state, so no CSRF/content-type
 * guard is needed (that's only for state-changing POST/PATCH/DELETE
 * routes per src/lib/security/parse-json-body.ts).
 */

const VALID_SORTS: ReviewSort[] = ["newest", "highest", "lowest"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    return NextResponse.json(
      { reviews: [], total: 0, page: 1, pageSize: 10, hasMore: false, error: "Product not found" },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const sortParam = url.searchParams.get("sort");
  const sort: ReviewSort | undefined = (VALID_SORTS as string[]).includes(sortParam ?? "")
    ? (sortParam as ReviewSort)
    : undefined;

  const pageParam = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const result = await getApprovedReviews(product.id, { sort, page });
  return NextResponse.json(result);
}
