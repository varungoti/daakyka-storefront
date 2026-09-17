import { NotificationList } from "@/components/admin/notification-list";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminNotificationsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  const [notifications, journeyEvents] = await Promise.all([
    db.adminNotification.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.journeyEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { journey: { select: { name: true } } },
    }),
  ]);

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Notifications & Journey Log</h1>
        <p className="text-muted">Admin alerts from journeys and engagement triggers.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Admin Notifications" value={String(notifications.length)} />
        <StatCard label="Unread" value={String(unread)} />
        <StatCard label="Journey Events" value={String(journeyEvents.length)} />
      </div>

      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">Admin Notifications</h2>
        <div className="mt-4">
          <NotificationList
            notifications={notifications.map((n) => ({
              id: n.id,
              title: n.title,
              body: n.body,
              read: n.read,
              createdAt: n.createdAt.toISOString(),
            }))}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">Journey Event Log</h2>
        <ul className="mt-4 space-y-3">
          {journeyEvents.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
              <div>
                <p className="font-semibold text-ink">{event.journey.name}</p>
                <p className="text-muted">
                  {event.channel} · {event.trigger} · {event.recipient ?? "—"}
                </p>
              </div>
              <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-semibold">
                {event.status}
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
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
    </div>
  );
}
