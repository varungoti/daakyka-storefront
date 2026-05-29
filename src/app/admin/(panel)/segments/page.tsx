import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function SegmentsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const segments = await db.customerSegment.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Customer Segments</h1>
        <p className="text-muted">Audience groups for targeted email and WhatsApp campaigns.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {segments.map((segment) => (
          <article key={segment.id} className="rounded-2xl border border-border bg-white p-5">
            <p className="font-display text-lg font-bold text-ink">{segment.name}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">{segment.slug}</p>
            {segment.description && <p className="mt-2 text-sm text-muted">{segment.description}</p>}
            <pre className="mt-3 overflow-x-auto rounded-xl bg-lavender/40 p-3 text-xs text-muted">
              {segment.criteria}
            </pre>
          </article>
        ))}
      </div>
    </div>
  );
}
