import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminMarketPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "market:view")) {
    redirect("/admin/dashboard");
  }

  const snapshots = await db.marketSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    take: 30,
  });

  const byCompetitor = snapshots.reduce<Record<string, number>>((acc, row) => {
    acc[row.competitor] = (acc[row.competitor] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Market Intelligence</h1>
        <p className="text-muted">
          Competitor observations and category trends — expand with Hermes weekly scans.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Snapshots" value={String(snapshots.length)} />
        <StatCard label="Competitors Tracked" value={String(Object.keys(byCompetitor).length)} />
        <StatCard label="Latest Capture" value={snapshots[0]?.capturedAt.toLocaleDateString("en-IN") ?? "—"} />
      </div>

      <section className="rounded-3xl border border-border bg-white p-6">
        <h2 className="font-display text-xl font-bold text-ink">Recent Observations</h2>
        <ul className="mt-4 space-y-4">
          {snapshots.map((snap) => (
            <li key={snap.id} className="rounded-2xl border border-border px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">{snap.competitor}</p>
                <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium text-muted">
                  {snap.category}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">{snap.observation}</p>
              <p className="mt-2 text-xs text-muted">{snap.capturedAt.toLocaleString("en-IN")}</p>
            </li>
          ))}
          {snapshots.length === 0 && (
            <p className="text-sm text-muted">No market snapshots yet. Run seed to load samples.</p>
          )}
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
