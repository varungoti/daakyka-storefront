import { ReviewsTab } from "@/components/account/account-tabs";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "My Reviews" };

/**
 * Release-hardening item 1 (F4). Auth is enforced by
 * src/app/account/(dashboard)/layout.tsx; the session is re-read here
 * only to scope this query to the caller's own reviews (same query the
 * old /account page ran before this route existed).
 */
export default async function AccountReviewsPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/account/login?returnTo=/account/reviews");

  const reviews = await db.review.findMany({
    where: { customerId: session.id },
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true, slug: true } } },
  });

  return (
    <ReviewsTab
      reviews={reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        status: review.status,
        createdAt: review.createdAt.toISOString(),
        productName: review.product.name,
        productSlug: review.product.slug,
      }))}
    />
  );
}
