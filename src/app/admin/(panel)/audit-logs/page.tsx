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

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              // F-289 fix: prefer the live User relation's name (so a
              // renamed account still shows its current name), but fall
              // back to the email snapshotted at write time — the row the
              // action was actually attributed to might have since been
              // deleted (userId is onDelete: SetNull).
              const actorLabel = log.user?.name ?? log.actorEmail ?? "System";
              return (
                <tr key={log.id} className="border-b border-border/70">
                  <td className="px-4 py-3 font-semibold text-ink">{log.action}</td>
                  <td className="px-4 py-3 text-muted">
                    {log.entity}
                    {log.entityId ? ` · ${log.entityId}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    {actorLabel}
                    {log.actorRole ? <span className="text-muted"> · {log.actorRole}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-muted" title={log.userAgent ?? undefined}>
                    {log.ipAddress ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {log.createdAt.toLocaleString("en-IN")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
