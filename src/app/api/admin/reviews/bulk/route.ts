import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { bulkApprove, bulkReject } from "@/lib/reviews/moderate-review";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { adminReviewBulkSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("reviews:moderate");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = adminReviewBulkSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // F-203: "reject" alongside the original "approve" for the bulk
  // moderation queue's "Reject N selected" action.
  const result =
    parsed.data.action === "approve"
      ? await bulkApprove(parsed.data.ids, session!.id)
      : await bulkReject(parsed.data.ids, session!.id);
  return NextResponse.json(result);
}
