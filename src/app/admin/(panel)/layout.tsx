import { AdminShell } from "@/components/admin/admin-shell";
import { UnsavedChangesProvider } from "@/components/admin/unsaved-changes";
import { hasPermission } from "@/lib/auth/rbac";
import { enforceAdminPasswordChange, getSessionResult } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { getPendingReviewCount } from "@/lib/reviews/pending-count";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  // F-171: every admin tab used to read "Admin | DAAKYKA Apparels". Each
  // page now exports its own `title` (e.g. "Orders"), which this template
  // turns into "Orders · Admin" — a page with no title of its own still
  // gets the plain default.
  title: { template: "%s · Admin", default: "Admin" },
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
        {/* A plain <a>, not <Link>: a full page load is the point — it
            re-runs this layout's DB-backed session check from scratch. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
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
  await enforceAdminPasswordChange(session);

  // These shell lookups are independent; the password-change flag was
  // already read by getSessionResult during its DB-backed verification.
  const [unreadNotifications, pendingReviews] = await Promise.all([
    // Cheap enough to fetch on every admin page load — a single count()
    // query — and getUnreadNotificationCount() already swallows DB errors
    // (returns 0) so a hiccup here never breaks the whole admin shell.
    getUnreadNotificationCount(),
    // F-297: same shape, only fetched for a role that can act on it —
    // getPendingReviewCount() also swallows DB errors, same as above.
    hasPermission(session.role, "reviews:moderate") ? getPendingReviewCount() : Promise.resolve(0),
  ]);

  return (
    // F-13: shared dirty-form state so a <GuardedLink> in the sidebar
    // (AdminShell) can confirm before navigating away from a dirty form
    // rendered in `children`, two levels down. See
    // src/components/admin/unsaved-changes.tsx.
    <UnsavedChangesProvider>
      <AdminShell
        user={session}
        unreadNotifications={unreadNotifications}
        pendingReviews={pendingReviews}
        mustChangePassword={session.mustChangePassword ?? false}
      >
        {children}
      </AdminShell>
    </UnsavedChangesProvider>
  );
}
