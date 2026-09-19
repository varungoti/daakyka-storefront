import { NotificationList } from "@/components/admin/notification-list";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listRecentEmailOutboxForAdmin } from "@/lib/engagement/outbox";
import { redirect } from "next/navigation";

export default async function AdminNotificationsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  const [notifications, journeyEvents, emailOutbox] = await Promise.all([
    db.adminNotification.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.journeyEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { journey: { select: { name: true } } },
    }),
    // F7 fix: transactional-email audit trail (src/lib/engagement/outbox.ts)
    // — every send attempt, not just failures, so SENT rows double as a
    // delivery log.
    listRecentEmailOutboxForAdmin(30),
  ]);

  const unread = notifications.filter((n) => !n.read).length;
  const undeliveredEmailCount = emailOutbox.filter((row) => row.status !== "SENT").length;

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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-ink">Email Outbox</h2>
          <p className="text-xs text-muted">
            {undeliveredEmailCount > 0
              ? `${undeliveredEmailCount} of the last ${emailOutbox.length} not yet delivered`
              : "All recent sends delivered"}
          </p>
        </div>
        <ul className="space-y-3">
          {emailOutbox.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm"
            >
              <div>
                <p className="font-semibold text-ink">
                  {row.subject} <span className="font-normal text-muted">→ {row.to}</span>
                </p>
                <p className="text-muted">
                  {row.kind} · {row.createdAt.toLocaleString("en-IN")}
                  {row.status !== "SENT" && row.attemptCount > 0 ? ` · ${row.attemptCount} attempt(s)` : ""}
                  {row.lastError ? ` · ${row.lastError}` : ""}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  row.status === "SENT"
                    ? "bg-trust/10 text-trust"
                    : row.status === "FAILED"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {row.status}
              </span>
            </li>
          ))}
          {emailOutbox.length === 0 && <p className="text-sm text-muted">No transactional email sent yet.</p>}
        </ul>
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
