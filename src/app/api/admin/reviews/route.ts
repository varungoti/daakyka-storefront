import { NextResponse } from "next/server";
import { ReviewStatus } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { listReviewsForAdmin } from "@/lib/reviews/moderate-review";

const REVIEW_STATUS_VALUES = new Set<string>(Object.values(ReviewStatus));

/** Backs the /admin/reviews moderation queue's filters (All/Pending/
 * Approved/Rejected, optionally scoped to one product). */
export async function GET(request: Request) {
  const { error } = await requireAdminPermission("reviews:moderate");
  if (error) return error;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam && !REVIEW_STATUS_VALUES.has(statusParam)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...REVIEW_STATUS_VALUES].join(", ")}` },
      { status: 400 },
    );
  }

  const productId = url.searchParams.get("productId") ?? undefined;
  const pageParam = Number(url.searchParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : undefined;

  const result = await listReviewsForAdmin({
    status: statusParam ? (statusParam as ReviewStatus) : undefined,
    productId,
    page,
  });

  return NextResponse.json(result);
}
