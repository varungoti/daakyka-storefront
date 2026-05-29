import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminAuditLogsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "audit:view")) {
    redirect("/admin/dashboard");
  }

  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Audit Logs</h1>
        <p className="text-muted">Recent admin actions across the platform.</p>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-border/70">
                <td className="px-4 py-3 font-semibold text-ink">{log.action}</td>
                <td className="px-4 py-3 text-muted">
                  {log.entity}
                  {log.entityId ? ` · ${log.entityId}` : ""}
                </td>
                <td className="px-4 py-3">{log.user?.name ?? "System"}</td>
                <td className="px-4 py-3 text-muted">
                  {log.createdAt.toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
