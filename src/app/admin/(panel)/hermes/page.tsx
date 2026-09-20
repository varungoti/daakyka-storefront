import { HermesApprovalActions } from "@/components/admin/hermes-approval-actions";
import { HermesTaskLauncher } from "@/components/admin/hermes-task-launcher";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { ApprovalExecutionResult } from "@/lib/hermes/approval-executor";
import { getHermesMode, isHermesInlineRuntime, isHermesRuntimeConfigured } from "@/lib/hermes/client";
import Link from "next/link";
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

      <section className="rounded-3xl border border-border bg-surface-elevated p-6">
        <h2 className="font-display text-xl font-bold text-ink">Run Hermes Workflow</h2>
        {/* F-10/F-18 (docs/audit-2026-09-19/admin-ux.md): explicit,
            environment-accurate copy about what clicking one of these
            buttons actually does, read out of the real handlers rather
            than guessed — see src/app/api/admin/hermes/tasks/route.ts,
            src/lib/hermes/client.ts (dispatchHermesTask), and
            src/lib/hermes/approval-executor.ts (what Approve does). */}
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each button below runs <strong>once</strong> and adds exactly one new item to the Approval Queue —{" "}
          {configured ? (
            <>
              it calls the configured {runtimeLabel} (a real external request; may incur cost or take a few seconds).
            </>
          ) : (
            <>
              since no runtime is configured (Runtime: Not configured, above), it returns a harmless local placeholder
              instead — <strong>no external call is made</strong> right now.
            </>
          )}{" "}
          Nothing is published or sent by clicking a workflow button itself: that only records a suggestion. Approving
          a queued item below goes one step further but still only ever creates a <em>draft</em> — a blog post left
          unpublished, or a campaign left at &ldquo;Pending Approval&rdquo; — never a live publish or an outbound
          send.
        </p>
        <div className="mt-4">
          <HermesTaskLauncher />
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface-elevated p-6">
        <h2 className="font-display text-xl font-bold text-ink">Approval Queue</h2>
        <ul className="mt-4 space-y-4">
          {approvals.map((item) => (
            <li key={item.id} className="rounded-2xl border border-border px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">{item.type}</p>
                  <p className="font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 text-sm text-muted">{item.summary}</p>
                  <ExecutionPreview title={item.title} result={item.executionResult as ApprovalExecutionResult | null} />
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

      <section className="rounded-3xl border border-border bg-surface-elevated p-6">
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

function ExecutionPreview({ title, result }: { title: string; result: ApprovalExecutionResult | null }) {
  if (!result || !result.ok) return null;

  switch (result.action) {
    case "blog_draft_created":
    case "blog_draft_exists": {
      const postTitle = title.replace(/^Blog:\s*/i, "");
      return (
        <p className="mt-2 text-sm text-trust">
          Created blog draft: &quot;{postTitle}&quot; —{" "}
          <Link href={`/admin/blog/${result.entityId}`} className="underline">
            open in CMS
          </Link>
        </p>
      );
    }
    case "campaign_draft_created":
    case "campaign_draft_exists": {
      const campaignName = title.replace(/^Campaign:\s*/i, "");
      return (
        <p className="mt-2 text-sm text-trust">
          Created campaign: &quot;{campaignName}&quot;, pending approval —{" "}
          <Link href="/admin/campaigns" className="underline">
            open Campaign Planner
          </Link>
        </p>
      );
    }
    case "notification_created":
    case "generic_notification":
      return <p className="mt-2 text-sm text-trust">{result.message ?? "Logged as an admin notification."}</p>;
    default:
      return null;
  }
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-elevated p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-xl font-bold text-brand">{value}</p>
    </div>
  );
}
