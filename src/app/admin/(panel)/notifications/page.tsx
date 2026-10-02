import { NotificationList } from "@/components/admin/notification-list";
import { AdminPager } from "@/components/admin/pager";
import { resolveNotificationLink } from "@/lib/admin/notification-links";
import {
  canViewEmailOutbox,
  canViewJourneyLog,
  canViewNotificationsPage,
  ORDER_NOTIFICATION_TYPES,
} from "@/lib/admin/notifications-access";
import { adminListHref, firstParam, getPageWindow, parsePageParam } from "@/lib/admin/pagination";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTimeIST } from "@/lib/format/datetime";
import { getUndeliveredEmailCount, listRecentEmailOutboxForAdmin } from "@/lib/engagement/outbox";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notifications" };

// F-168: the feed used to be a single `take: 30` with no way to reach
// anything older (2,000+ rows on a busy store, older unread ones included).
const NOTIFICATIONS_PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<{ page?: string | string[]; filter?: string | string[] }>;
}

/**
 * F-268: this page used to gate everything — the generic notification
 * feed, the Email Outbox (customer order/verify/reset emails) and the
 * Journey Event Log — on a single "bulk-orders:manage" check. That got
 * the RBAC backwards: MARKETING_ADMIN (journeys/engagement, no
 * bulk-orders:manage) was redirected away from its own Journey Event
 * Log, while BULK_ORDER_MANAGER (bulk-orders:manage, but no
 * orders:view/customers:view — /admin/orders and /admin/customers both
 * correctly turn it away) could read every customer's transactional
 * email. Each section below is now gated on the permission that governs
 * the *kind* of data it shows — see src/lib/admin/notifications-access.ts.
 */
export default async function AdminNotificationsPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session || !canViewNotificationsPage(session.role)) {
    redirect("/admin/dashboard");
  }

  const canOutbox = canViewEmailOutbox(session.role);
  const canJourneys = canViewJourneyLog(session.role);
  // Order-type AdminNotification rows (new-order alerts — see
  // src/lib/orders/notify.ts) carry the same customer email + amount the
  // outbox does, so they're excluded from the generic list the same way.
  const notificationWhere = canOutbox ? {} : { type: { notIn: [...ORDER_NOTIFICATION_TYPES] } };

  const rawParams = await searchParams;
  const unreadOnly = firstParam(rawParams.filter) === "unread";
  const requestedPage = parsePageParam(rawParams.page);

  const [totalNotifications, unreadCount, journeyEvents, journeyEventTotal, emailOutbox, undeliveredEmail] =
    await Promise.all([
      db.adminNotification.count({ where: notificationWhere }),
      db.adminNotification.count({ where: { ...notificationWhere, read: false } }),
      canJourneys
        ? db.journeyEvent.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { journey: { select: { name: true } } },
          })
        : Promise.resolve([]),
      // F-268: the stat cards used to show `.length` of the 20-30 rows
      // fetched above, not the real total — 30/29/20 against a DB of
      // 2000+. These are real counts.
      canJourneys ? db.journeyEvent.count() : Promise.resolve(0),
      // F7 fix: transactional-email audit trail (src/lib/engagement/
      // outbox.ts) — every send attempt, not just failures, so SENT rows
      // double as a delivery log.
      canOutbox ? listRecentEmailOutboxForAdmin(30) : Promise.resolve([]),
      canOutbox ? getUndeliveredEmailCount() : Promise.resolve({ total: 0, failed: 0 }),
    ]);

  // F-168: page through the feed (optionally unread-only) instead of
  // capping it. The window is built from the same counts the stat cards
  // use, so a stale `?page=` past the end clamps to the last page.
  const feedWindow = getPageWindow(requestedPage, unreadOnly ? unreadCount : totalNotifications, NOTIFICATIONS_PAGE_SIZE);
  const notifications = await db.adminNotification.findMany({
    where: unreadOnly ? { ...notificationWhere, read: false } : notificationWhere,
    orderBy: { createdAt: "desc" },
    skip: feedWindow.skip,
    take: feedWindow.take,
  });
  const hrefForPage = (page: number) =>
    adminListHref("/admin/notifications", { filter: unreadOnly ? "unread" : undefined, page });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Notifications & Journey Log</h1>
        <p className="text-muted">Admin alerts from journeys and engagement triggers.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Admin Notifications" value={String(totalNotifications)} />
        <StatCard label="Unread" value={String(unreadCount)} />
        {canJourneys && <StatCard label="Journey Events" value={String(journeyEventTotal)} />}
      </div>

      <section className="rounded-3xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-ink">Admin Notifications</h2>
          <div className="flex gap-2 text-xs font-semibold" role="group" aria-label="Filter notifications">
            <Link
              href="/admin/notifications"
              aria-current={unreadOnly ? undefined : "true"}
              className={`rounded-full border px-3 py-1.5 ${unreadOnly ? "border-border text-muted hover:bg-lilac/40" : "border-brand bg-brand/10 text-brand"}`}
            >
              All
            </Link>
            <Link
              href="/admin/notifications?filter=unread"
              aria-current={unreadOnly ? "true" : undefined}
              className={`rounded-full border px-3 py-1.5 ${unreadOnly ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-lilac/40"}`}
            >
              Unread ({unreadCount})
            </Link>
          </div>
        </div>
        <div className="mt-4">
          <NotificationList
            unreadTotal={unreadCount}
            emptyMessage={unreadOnly ? "No unread notifications." : "No notifications yet."}
            notifications={notifications.map((n) => ({
              id: n.id,
              title: n.title,
              body: n.body,
              read: n.read,
              createdAt: n.createdAt.toISOString(),
              link: resolveNotificationLink(session.role, n.type, n.metadata),
            }))}
          />
        </div>
        <AdminPager
          page={feedWindow.page}
          totalPages={feedWindow.totalPages}
          total={feedWindow.total}
          noun={unreadOnly ? "unread" : "notifications"}
          hrefForPage={hrefForPage}
          label="Notification pagination"
        />
      </section>

      {canOutbox && (
        <section className="rounded-3xl border border-border bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-ink">Email Outbox</h2>
            <p className="text-xs text-muted">
              {undeliveredEmail.total > 0
                ? `${undeliveredEmail.total} of the last ${emailOutbox.length} not yet delivered`
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
                    {row.kind} · {formatDateTimeIST(row.createdAt)}
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
      )}

      {canJourneys && (
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
      )}
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
