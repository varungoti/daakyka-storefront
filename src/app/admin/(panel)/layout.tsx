import { AdminShell } from "@/components/admin/admin-shell";
import { UnsavedChangesProvider } from "@/components/admin/unsaved-changes";
import { hasPermission } from "@/lib/auth/rbac";
import { getSessionResult } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { getPendingReviewCount } from "@/lib/reviews/pending-count";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getSessionResult();

  // F-369: a DB outage while checking the session must not look like an
  // ordinary logged-out admin — redirecting to /admin/login here would be
  // indistinguishable from a real expired session, and re-login would
  // fail too (it also needs the DB), leaving the admin with no idea what
  // is actually wrong.
  if (result.status === "db-unavailable") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
          Temporarily unavailable
        </p>
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">
          We can&apos;t reach the database right now
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Your session is fine — this isn&apos;t a login problem. Please try again in a moment.
        </p>
        <a
          href="/admin/dashboard"
          className="mt-8 rounded-md bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          Try again
        </a>
      </div>
    );
  }

  if (result.status !== "ok") {
    redirect("/admin/login");
  }
  const session = result.user;

  // Cheap enough to fetch on every admin page load — a single count()
  // query — and getUnreadNotificationCount() already swallows DB errors
  // (returns 0) so a hiccup here never breaks the whole admin shell.
  const unreadNotifications = await getUnreadNotificationCount();
  // F-297: same shape, only fetched for a role that can act on it —
  // getPendingReviewCount() also swallows DB errors, same as above.
  const pendingReviews = hasPermission(session.role, "reviews:moderate")
    ? await getPendingReviewCount()
    : 0;

  return (
    // F-13: shared dirty-form state so a <GuardedLink> in the sidebar
    // (AdminShell) can confirm before navigating away from a dirty form
    // rendered in `children`, two levels down. See
    // src/components/admin/unsaved-changes.tsx.
    <UnsavedChangesProvider>
      <AdminShell user={session} unreadNotifications={unreadNotifications} pendingReviews={pendingReviews}>
        {children}
      </AdminShell>
    </UnsavedChangesProvider>
  );
}
