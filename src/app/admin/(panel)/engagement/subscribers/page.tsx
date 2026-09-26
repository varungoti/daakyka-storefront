import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateIST } from "@/lib/format/datetime";
import type { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

/**
 * F-153: there was no admin page at all for the newsletter list — the
 * only reads anywhere in src/app/admin were two unfiltered `count()`
 * calls (the dashboard tile and this same Engagement Hub). This is the
 * paginated list + status filter the fix guidance asked for, with a CSV
 * export (see /api/admin/newsletter-subscribers/export) alongside it.
 *
 * `confirmToken`/`unsubscribeToken` are live secrets (a valid unsubscribe
 * or confirm link) — never selected here.
 */
const pageParamSchema = z.coerce.number().int().min(1).max(100_000).catch(1);
const statusParamSchema = z.enum(["all", "active", "pending", "unsubscribed"]).catch("all");
const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}

function statusWhere(status: "all" | "active" | "pending" | "unsubscribed"): Prisma.NewsletterSubscriberWhereInput {
  switch (status) {
    case "active":
      return { consentGiven: true, confirmedAt: { not: null }, unsubscribedAt: null };
    case "pending":
      return { confirmedAt: null, unsubscribedAt: null };
    case "unsubscribed":
      return { unsubscribedAt: { not: null } };
    case "all":
    default:
      return {};
  }
}

function subscriberStatusLabel(subscriber: { confirmedAt: Date | null; unsubscribedAt: Date | null }): string {
  if (subscriber.unsubscribedAt) return "Unsubscribed";
  if (!subscriber.confirmedAt) return "Pending confirmation";
  return "Active";
}

export default async function AdminNewsletterSubscribersPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const { page: rawPage, status: rawStatus, q: rawQuery } = await searchParams;
  const page = pageParamSchema.parse(rawPage);
  const status = statusParamSchema.parse(rawStatus);
  const query = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 254) : "";

  const where: Prisma.NewsletterSubscriberWhereInput = {
    ...statusWhere(status),
    ...(query ? { email: { contains: query, mode: "insensitive" } } : {}),
  };

  const [subscribers, total] = await Promise.all([
    db.newsletterSubscriber.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        source: true,
        consentGiven: true,
        confirmedAt: true,
        unsubscribedAt: true,
        createdAt: true,
      },
    }),
    db.newsletterSubscriber.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const queryString = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (query) params.set("q", query);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === "" || value === "all") params.delete(key);
      else params.set(key, String(value));
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Newsletter Subscribers</h1>
          <p className="text-muted">{total} matching this filter.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/engagement"
            className="text-sm font-semibold text-brand hover:underline"
          >
            ← Engagement Hub
          </Link>
          <a
            href={`/api/admin/newsletter-subscribers/export${queryString({ page: "" })}`}
            className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-lilac/40"
          >
            Export CSV
          </a>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-3">
        {/* A GET form with no `action` submits to this page's own path
            (dropping any existing query string) — the status filter has
            to be re-sent as a hidden field or it would silently reset to
            "all" every time someone searches. */}
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by email"
          className="rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-2 text-sm">
          {(["all", "active", "pending", "unsubscribed"] as const).map((option) => (
            <Link
              key={option}
              href={`/admin/engagement/subscribers${queryString({ status: option, page: "" })}`}
              className={`rounded-full px-3 py-1.5 font-semibold ${
                status === option ? "bg-brand text-white" : "border border-border text-muted hover:bg-lilac/40"
              }`}
            >
              {option === "all" ? "All" : option.charAt(0).toUpperCase() + option.slice(1)}
            </Link>
          ))}
        </div>
        <button
          type="submit"
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
        >
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Signed up</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((subscriber) => (
              <tr key={subscriber.id} className="border-b border-border/70">
                <td className="px-4 py-3 font-medium text-ink">{subscriber.email}</td>
                <td className="px-4 py-3 text-muted">{subscriber.source}</td>
                <td className="px-4 py-3 text-muted">{subscriberStatusLabel(subscriber)}</td>
                <td className="px-4 py-3 text-muted">{formatDateIST(subscriber.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {subscribers.length === 0 && (
          <p className="p-8 text-center text-muted">No subscribers match this filter.</p>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between pt-2 text-sm" aria-label="Subscriber pagination">
          {page > 1 ? (
            <Link href={`/admin/engagement/subscribers${queryString({ page: page - 1 })}`} className="font-semibold text-brand hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/admin/engagement/subscribers${queryString({ page: page + 1 })}`} className="font-semibold text-brand hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
