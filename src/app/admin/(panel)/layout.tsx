import { AdminShell } from "@/components/admin/admin-shell";
import { UnsavedChangesProvider } from "@/components/admin/unsaved-changes";
import { getSession } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/notifications";
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
  const session = await getSession();

  if (!session) {
    redirect("/admin/login");
  }

  // Cheap enough to fetch on every admin page load — a single count()
  // query — and getUnreadNotificationCount() already swallows DB errors
  // (returns 0) so a hiccup here never breaks the whole admin shell.
  const unreadNotifications = await getUnreadNotificationCount();

  return (
    // F-13: shared dirty-form state so a <GuardedLink> in the sidebar
    // (AdminShell) can confirm before navigating away from a dirty form
    // rendered in `children`, two levels down. See
    // src/components/admin/unsaved-changes.tsx.
    <UnsavedChangesProvider>
      <AdminShell user={session} unreadNotifications={unreadNotifications}>
        {children}
      </AdminShell>
    </UnsavedChangesProvider>
  );
}
