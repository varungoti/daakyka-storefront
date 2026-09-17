import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/customer-auth/session";
import {
  AlreadyReviewedError,
  createReview,
  InvalidReviewInputError,
  ProductNotActiveError,
  ProductNotFoundError,
} from "@/lib/reviews/create-review";
import { reviewSubmissionGate } from "@/lib/reviews/eligibility";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { reviewCreateSchema } from "@/lib/validation/schemas";

/**
 * Phase D2: public route (no admin permission), but requires an
 * authenticated + email-verified CUSTOMER session — never an admin
 * session, and never a client-supplied customerId/verifiedPurchase (both
 * are always derived server-side, see lib/reviews/create-review.ts).
 */
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "reviews-create", 5, 60_000);
  if (limited) return limited;

  const session = await getCustomerSession();
  const gate = reviewSubmissionGate(session);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = reviewCreateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const review = await createReview({
      customerId: session!.id,
      productId: parsed.data.productId,
      rating: parsed.data.rating,
      title: parsed.data.title,
      body: parsed.data.body,
      photoAssetIds: parsed.data.photoAssetIds,
    });

    // Public-safe shape only — never the customer, verifiedPurchase
    // derivation, or any other customer's data.
    return NextResponse.json({ id: review.id, status: review.status }, { status: 201 });
  } catch (error) {
    if (error instanceof AlreadyReviewedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ProductNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ProductNotActiveError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidReviewInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
