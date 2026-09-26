import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  approveReview,
  rejectReview,
  ReviewConcurrentModificationError,
  ReviewNotFoundError,
} from "@/lib/reviews/moderate-review";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { adminReviewModerateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("reviews:moderate");
  if (error) return error;

  const { id } = await params;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = adminReviewModerateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const options = { fromStatus: parsed.data.fromStatus };
    const result =
      parsed.data.action === "approve"
        ? await approveReview(id, session!.id, options)
        : await rejectReview(id, session!.id, parsed.data.reason, options);

    return NextResponse.json({ review: result });
  } catch (err) {
    if (err instanceof ReviewNotFoundError) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    // F-343: someone else already moderated this review since this admin
    // last loaded it — a 409 tells the client to reload rather than
    // silently overwrite that other moderator's decision.
    if (err instanceof ReviewConcurrentModificationError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
