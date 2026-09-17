import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

/**
 * Placeholder — the review moderation queue (approve/reject, bulk approve,
 * verified-purchase badge) ships in Phase D2, once customer accounts and
 * reviews exist. This page exists so the "Reviews" nav link resolves and
 * still enforces `reviews:moderate`.
 */
export default async function AdminReviewsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "reviews:moderate")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Reviews</h1>
        <p className="text-muted">Review moderation is coming next.</p>
      </div>
      <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        Review moderation ships once customer accounts and product reviews land (Phase D).
      </div>
    </div>
  );
}
