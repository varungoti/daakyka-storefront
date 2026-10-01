import { AdminPager } from "@/components/admin/pager";
import {
  AUDIT_ACTION_SUGGESTIONS,
  AUDIT_ENTITY_LABELS,
  auditActionLabel,
  auditEntityHref,
  auditEntityLabel,
  buildAuditWhere,
  formatAuditMetadata,
  parseAuditFilters,
  shortenAuditId,
} from "@/lib/admin/audit-log-view";
import { adminListHref, getPageWindow, type RawSearchParam } from "@/lib/admin/pagination";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTimeIST } from "@/lib/format/datetime";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit Logs" };

// F-167: 100 raw rows with no way past them hid everything older than a
// few hours on a busy store (32,000+ rows). 50 per page, newest first.
const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<Record<string, RawSearchParam>>;
}

export default async function AdminAuditLogsPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "audit:view")) {
    redirect("/admin/dashboard");
  }

  const filters = parseAuditFilters(await searchParams);
  const where = buildAuditWhere(filters);

  const [total, users] = await Promise.all([
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pageWindow = getPageWindow(filters.page, total, PAGE_SIZE);
  const logs = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pageWindow.skip,
    take: pageWindow.take,
    include: { user: { select: { name: true, email: true } } },
  });

  const hasFilters = Boolean(filters.entity || filters.action || filters.userId || filters.from || filters.to);
  const hrefForPage = (page: number) =>
    adminListHref("/admin/audit-logs", {
      entity: filters.entity,
      action: filters.action,
      user: filters.userId,
      from: filters.from,
      to: filters.to,
      page,
    });

  // A filtered entity this map has never heard of (a stale bookmark) still
  // needs to show up as the selected option rather than silently resetting.
  const entityOptions = Object.entries(AUDIT_ENTITY_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (filters.entity && !entityOptions.some((option) => option.value === filters.entity)) {
    entityOptions.push({ value: filters.entity, label: auditEntityLabel(filters.entity) });
  }

  const inputClass = "mt-1 w-full rounded-xl border border-border bg-surface p-2 text-sm text-ink outline-none focus:border-brand";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Audit Logs</h1>
        <p className="text-muted">Who changed what across the platform, newest first.</p>
      </div>

      {/* A plain GET form — the filters live in the URL, so a filtered view
          can be bookmarked or shared and the Back button just works. */}
      <form
        method="get"
        action="/admin/audit-logs"
        className="grid gap-3 rounded-3xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="block text-xs font-semibold text-muted">
          Record type
          <select name="entity" defaultValue={filters.entity ?? ""} className={inputClass}>
            <option value="">All record types</option>
            {entityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-muted">
          Action
          <input
            name="action"
            list="audit-action-suggestions"
            defaultValue={filters.action ?? ""}
            placeholder="e.g. update"
            autoComplete="off"
            className={inputClass}
          />
          <datalist id="audit-action-suggestions">
            {AUDIT_ACTION_SUGGESTIONS.map((action) => (
              <option key={action} value={action} />
            ))}
          </datalist>
        </label>
        <label className="block text-xs font-semibold text-muted">
          Changed by
          <select name="user" defaultValue={filters.userId ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-muted">
          From (IST)
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-muted">
          To (IST)
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={inputClass} />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
          >
            Apply filters
          </button>
          {hasFilters ? (
            <Link href="/admin/audit-logs" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
              Clear
            </Link>
          ) : null}
          <p className="ml-auto text-xs text-muted">
            {total === 0
              ? "No matching entries"
              : `Showing ${pageWindow.skip + 1}–${pageWindow.skip + logs.length} of ${total}`}
          </p>
        </div>
      </form>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Record</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">IP</th>
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
              const entityHref = auditEntityHref(session.role, log.entity, log.entityId);
              const metadata = formatAuditMetadata(log.metadata);
              return (
                <tr key={log.id} className="border-b border-border/70 align-top">
                  {/* F-060: server-rendered in the process timezone
                      previously — UTC on Vercel, 5.5h behind IST — now
                      pinned to IST explicitly. */}
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTimeIST(log.createdAt)}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{auditActionLabel(log.action)}</p>
                    {metadata ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-brand">Details</summary>
                        <pre className="mt-1 max-w-xs overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-lavender/30 p-2 text-[11px] text-ink sm:max-w-md">
                          {metadata}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {entityHref ? (
                      <Link href={entityHref} className="font-semibold text-brand hover:underline">
                        {auditEntityLabel(log.entity)}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink">{auditEntityLabel(log.entity)}</span>
                    )}
                    {log.entityId ? (
                      <span className="block break-all text-xs" title={log.entityId}>
                        {shortenAuditId(log.entityId)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {actorLabel}
                    {log.actorRole ? <span className="text-muted"> · {log.actorRole}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-muted" title={log.userAgent ?? undefined}>
                    {log.ipAddress ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {logs.length === 0 ? (
          <p className="p-8 text-center text-muted">
            {hasFilters ? "No audit entries match these filters." : "No audit entries yet."}
          </p>
        ) : null}
      </div>

      <AdminPager
        page={pageWindow.page}
        totalPages={pageWindow.totalPages}
        total={pageWindow.total}
        noun="entries"
        hrefForPage={hrefForPage}
        label="Audit log pagination"
      />
    </div>
  );
}
