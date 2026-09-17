import { UserInviteForm } from "@/components/admin/user-invite-form";
import { UserRoleEditor } from "@/components/admin/user-role-editor";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

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

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface-elevated">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRoleEditor key={user.id} user={user} currentUserId={session.id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
