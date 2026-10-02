import { UserInviteForm } from "@/components/admin/user-invite-form";
import { UserRoleEditor } from "@/components/admin/user-role-editor";
import { isLocked } from "@/lib/auth/lockout";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "users:manage")) {
    redirect("/admin/dashboard");
  }

  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">User & Role Management</h1>
        <p className="text-muted">Assign roles and manage admin access with RBAC.</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Invite a new admin</h2>
        <UserInviteForm />
      </section>

      {/* F-166: from lg up this is the usual table. Below lg each row
          (UserRoleEditor's <tr>) is laid out as a stacked card with display
          overrides, so the role, Active toggle and the Reset password /
          Delete buttons are all on screen without a sideways swipe — and
          each row stays a single component instance, so a one-time temporary
          password shown after a reset can't be lost to a resize. */}
      <div className="lg:overflow-x-auto lg:rounded-3xl lg:border lg:border-border lg:bg-surface-elevated">
        <table className="block min-w-full text-left text-sm lg:table">
          <thead className="hidden border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted lg:table-header-group">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="block space-y-3 lg:table-row-group lg:space-y-0">
            {users.map((user) => (
              <UserRoleEditor
                key={user.id}
                user={{
                  ...user,
                  // Only pass lockedUntil through when the lock is still in
                  // effect (src/lib/auth/lockout.ts's isLocked) — computed
                  // here rather than in the client component, since a
                  // Date.now() call isn't allowed directly in a component's
                  // render body (react-hooks/purity).
                  lockedUntil: isLocked(user) ? user.lockedUntil!.toISOString() : null,
                }}
                currentUserId={session.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
