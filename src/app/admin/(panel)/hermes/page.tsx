import { HermesApprovalActions } from "@/components/admin/hermes-approval-actions";
import { HermesTaskLauncher } from "@/components/admin/hermes-task-launcher";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getHermesMode, isHermesInlineRuntime, isHermesRuntimeConfigured } from "@/lib/hermes/client";
import { redirect } from "next/navigation";

export default async function AdminHermesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "hermes:manage")) {
    redirect("/admin/dashboard");
  }

  const [approvals, tasks, pendingCount] = await Promise.all([
    db.hermesApproval.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { task: true } }),
    db.hermesTask.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.hermesApproval.count({ where: { status: "PENDING" } }),
  ]);

  const configured = isHermesRuntimeConfigured();
  const mode = getHermesMode();
  const runtimeLabel = isHermesInlineRuntime()
    ? "Vercel inline"
    : configured
      ? "HTTP runtime"
      : "Local stub";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Hermes Agent</h1>
        <p className="text-muted">
          Autonomous marketing intelligence — all outputs require approval before publish or send.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Operating Mode" value={mode.replace(/_/g, " ")} />
        <StatCard label="Runtime" value={configured ? runtimeLabel : "Not configured"} />
        <StatCard label="Pending Approvals" value={String(pendingCount)} />
      </div>

      <section className="rounded-3xl border border-border bg-white p-6">
        <h2 className="font-display text-xl font-bold text-ink">Run Hermes Workflow</h2>
        <p className="mt-1 text-sm text-muted">Outputs land in the approval queue — never auto-published.</p>
        <div className="mt-4">
          <HermesTaskLauncher />
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-white p-6">
        <h2 className="font-display text-xl font-bold text-ink">Approval Queue</h2>
        <ul className="mt-4 space-y-4">
          {approvals.map((item) => (
            <li key={item.id} className="rounded-2xl border border-border px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">{item.type}</p>
                  <p className="font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 text-sm text-muted">{item.summary}</p>
                </div>
                <HermesApprovalActions approvalId={item.id} currentStatus={item.status} />
              </div>
            </li>
          ))}
          {approvals.length === 0 && (
            <p className="text-sm text-muted">No Hermes recommendations in queue.</p>
          )}
        </ul>
      </section>

      <section className="rounded-3xl border border-border bg-white p-6">
        <h2 className="font-display text-xl font-bold text-ink">Recent Tasks</h2>
        <ul className="mt-4 space-y-3">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
              <div>
                <p className="font-semibold text-ink">{task.type.replace(/_/g, " ")}</p>
                <p className="text-muted">{task.mode} · {task.createdAt.toLocaleString("en-IN")}</p>
              </div>
              <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-semibold">
                {task.status}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-xl font-bold text-brand">{value}</p>
    </div>
  );
}
