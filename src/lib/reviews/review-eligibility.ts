import type { CustomerSessionUser } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";

/**
 * Phase D2: the real "can this visitor write a review for this product"
 * state — replaces the Phase C5 placeholder that only ever checked for the
 * customer cookie's *presence* (D1 didn't exist yet, so it was always
 * "guest"). Computed server-side from the real customer session (never
 * trusted from the client) plus a single extra lookup against the
 * @@unique([productId, customerId]) constraint that also backs
 * createReview()'s own duplicate check — cheap, and means the button never
 * has to render a form only to 409 on submit for a customer who already
 * reviewed this exact product.
 *
 * F-256: this used to run inside the product page itself, whose
 * `cookies()` read made every PDP view a per-request, no-store render. It is
 * answered by GET /api/products/[handle]/review-eligibility now, which the
 * page's review section calls from the browser, so the page itself reads no
 * cookie and can be prerendered.
 */
export type ReviewEligibility =
  | { status: "guest" }
  | { status: "unverified"; email: string }
  | { status: "already-reviewed" }
  // F-296: a REJECTED review no longer permanently blocks this customer
  // from this product — distinct from "already-reviewed" (a
  // PENDING/APPROVED review, which does still block a second submission)
  // so the PDP can offer a fresh Write a Review form instead of a dead
  // end. See createReview's resubmit-on-REJECTED path.
  | { status: "rejected" }
  | { status: "eligible" };

export async function getReviewEligibility(
  session: Pick<CustomerSessionUser, "id" | "email" | "emailVerifiedAt"> | null,
  productId: string,
): Promise<ReviewEligibility> {
  if (!session) return { status: "guest" };
  if (!session.emailVerifiedAt) return { status: "unverified", email: session.email };

  const existing = await db.review.findUnique({
    where: { productId_customerId: { productId, customerId: session.id } },
    select: { id: true, status: true },
  });
  // F-296: only a still-live (PENDING/APPROVED) review counts as "already
  // reviewed" — a REJECTED one can be rewritten.
  if (existing?.status === "REJECTED") return { status: "rejected" };
  if (existing) return { status: "already-reviewed" };

  return { status: "eligible" };
}
