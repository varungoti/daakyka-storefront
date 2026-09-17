import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { bulkApprove } from "@/lib/reviews/moderate-review";
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

  const result = await bulkApprove(parsed.data.ids, session!.id);
  return NextResponse.json(result);
}
