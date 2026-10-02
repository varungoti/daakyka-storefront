import { cache } from "react";
import { db } from "@/lib/db";

/**
 * F-297: nothing told the owner a review was waiting for moderation — no
 * dashboard tile, no sidebar badge. `createReview`
 * (src/lib/reviews/create-review.ts) only ever inserts the row; this is
 * a read-only count used by the dashboard tile and the admin shell's
 * "Reviews" nav badge, deliberately kept separate from that file (which
 * belongs to a different release-hardening package) so it can be reused
 * without touching it.
 *
 * Mirrors `getUnreadNotificationCount`'s fail-open shape
 * (src/lib/notifications.ts): a DB hiccup here must never break the
 * whole admin shell, so it swallows errors and returns 0 rather than
 * throwing.
 *
 * F-262: wrapped in React `cache()` — the admin layout (sidebar badge) and
 * the dashboard page (tile) both ask for this in the same request, and
 * share one query this way. Outside a render it just calls through.
 */
export const getPendingReviewCount = cache(async function getPendingReviewCount(): Promise<number> {
  try {
    return await db.review.count({ where: { status: "PENDING" } });
  } catch {
    return 0;
  }
});
