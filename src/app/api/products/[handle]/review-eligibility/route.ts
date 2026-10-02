import { getCustomerSession } from "@/lib/customer-auth/session";
import { getProductByHandle } from "@/lib/products";
import { getReviewEligibility } from "@/lib/reviews/review-eligibility";
import { NextResponse } from "next/server";

/**
 * F-256: whether the signed-in visitor (if any) may write a review for this
 * product — the part of the product page that depends on the customer
 * session cookie. The page used to resolve it during its own render, which
 * made every product page a per-request, uncacheable render; the page's
 * review section asks for it from the browser instead. Reads the cookie, so
 * it is always dynamic, and its answer is per visitor, so it is never cached
 * by a shared cache or the browser.
 *
 * It only controls which call-to-action the page shows — POST /api/reviews
 * (createReview) re-checks the session, the verified email and the duplicate
 * review itself.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);
  if (!product) {
    return NextResponse.json(
      { error: "Product not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const session = await getCustomerSession();
  const eligibility = await getReviewEligibility(session, product.id);
  return NextResponse.json(eligibility, { headers: { "Cache-Control": "private, no-store" } });
}
