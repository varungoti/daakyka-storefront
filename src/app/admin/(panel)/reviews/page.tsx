import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { listReviewsForAdmin } from "@/lib/reviews/moderate-review";
import { ReviewsAdminClient } from "./reviews-admin-client";

/**
 * Phase D2: the review moderation queue, replacing the Phase B2/C5
 * placeholder. Follows the same page-guard pattern as every other admin
 * page (getSession + hasPermission + redirect) — see
 * src/app/admin/(panel)/testimonials/page.tsx.
 */
export default async function AdminReviewsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "reviews:moderate")) {
    redirect("/admin/dashboard");
  }

  const initialData = await listReviewsForAdmin({ status: "PENDING" });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Reviews</h1>
        <p className="text-muted">Moderate customer reviews before they go live on product pages.</p>
      </div>
      <ReviewsAdminClient initialData={initialData} initialStatus="PENDING" />
    </div>
  );
}
