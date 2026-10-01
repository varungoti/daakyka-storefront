import { ContactEnquiryStatusSelect } from "@/components/admin/contact-enquiry-status-select";
import { AdminPager } from "@/components/admin/pager";
import { adminListHref, firstParam, getPageWindow, parsePageParam, type RawSearchParam } from "@/lib/admin/pagination";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateIST } from "@/lib/format/datetime";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact Enquiries" };

const PAGE_SIZE = 50;

// F-201: the status values ContactEnquiryStatusSelect / the PATCH route
// accept — the page filter is limited to the same set (anything else in a
// `?status=` URL just means "all").
const STATUS_FILTERS = [
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "CLOSED", label: "Closed" },
] as const;

const REPLY_SUBJECT = encodeURIComponent("Re: your enquiry to DAAKYKA");

interface PageProps {
  searchParams: Promise<{ page?: RawSearchParam; status?: RawSearchParam }>;
}

export default async function AdminContactEnquiriesPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  const rawParams = await searchParams;
  const requestedPage = parsePageParam(rawParams.page);
  const rawStatus = firstParam(rawParams.status);
  const statusFilter = STATUS_FILTERS.find((filter) => filter.value === rawStatus)?.value;
  const where = statusFilter ? { status: statusFilter } : {};

  // F-049: this used to load every row with no `take` at all (274+ rows
  // and growing, unpaginated). F-201: and a status filter, so the owner
  // can work through just the NEW ones instead of paging past handled rows.
  const [total, statusGroups] = await Promise.all([
    db.contactEnquiry.count({ where }),
    db.contactEnquiry.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const pageWindow = getPageWindow(requestedPage, total, PAGE_SIZE);
  const enquiries = await db.contactEnquiry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: pageWindow.skip,
    take: pageWindow.take,
  });
  const countFor = (status: string) => statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const allCount = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
  const hrefForPage = (page: number) => adminListHref("/admin/contact-enquiries", { status: statusFilter, page });
  const emptyMessage = statusFilter ? "No enquiries with this status." : "No contact enquiries yet.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Contact Enquiries</h1>
        <p className="text-muted">General, institutional, and support messages from the contact form.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-semibold" role="group" aria-label="Filter by status">
        <Link
          href="/admin/contact-enquiries"
          aria-current={statusFilter ? undefined : "true"}
          className={`rounded-full border px-3 py-1.5 ${statusFilter ? "border-border text-muted hover:bg-lilac/40" : "border-brand bg-brand/10 text-brand"}`}
        >
          All ({allCount})
        </Link>
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={adminListHref("/admin/contact-enquiries", { status: filter.value })}
            aria-current={statusFilter === filter.value ? "true" : undefined}
            className={`rounded-full border px-3 py-1.5 ${statusFilter === filter.value ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-lilac/40"}`}
          >
            {filter.label} ({countFor(filter.value)})
          </Link>
        ))}
      </div>

      {/* F-049: below `md`, the table's Message column ran off a 375px
          viewport with no way to reach it short of scrolling sideways —
          this stacked-card layout replaces the table entirely on small
          screens instead of trying to squeeze it in. */}
      <div className="space-y-3 md:hidden">
        {enquiries.map((enquiry) => (
          <div key={enquiry.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{enquiry.name}</p>
                <a
                  href={`mailto:${enquiry.email}?subject=${REPLY_SUBJECT}`}
                  className="block truncate text-sm text-brand hover:underline"
                >
                  {enquiry.email}
                </a>
                {enquiry.phone && (
                  <a href={`tel:${enquiry.phone}`} className="block text-sm text-brand hover:underline">
                    {enquiry.phone}
                  </a>
                )}
                {enquiry.organization && <p className="mt-1 text-xs text-muted">{enquiry.organization}</p>}
              </div>
              <span className="shrink-0 rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium">
                {enquiry.type.replace("_", " ")}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted">{enquiry.message}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{formatDateIST(enquiry.createdAt)}</p>
              <ContactEnquiryStatusSelect enquiryId={enquiry.id} currentStatus={enquiry.status} />
            </div>
          </div>
        ))}
        {enquiries.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-8 text-center text-muted">{emptyMessage}</p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl border border-border bg-surface md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((enquiry) => (
              <tr key={enquiry.id} className="border-b border-border/70 align-top">
                <td className="px-4 py-4">
                  <p className="font-semibold text-ink">{enquiry.name}</p>
                  <a href={`mailto:${enquiry.email}?subject=${REPLY_SUBJECT}`} className="text-brand hover:underline">
                    {enquiry.email}
                  </a>
                  {enquiry.phone && (
                    <a href={`tel:${enquiry.phone}`} className="block text-muted hover:text-brand hover:underline">
                      {enquiry.phone}
                    </a>
                  )}
                  {enquiry.organization && (
                    <p className="mt-1 text-xs text-brand">{enquiry.organization}</p>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium">
                    {enquiry.type.replace("_", " ")}
                  </span>
                </td>
                <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-4 text-muted">{enquiry.message}</td>
                <td className="px-4 py-4">
                  <ContactEnquiryStatusSelect enquiryId={enquiry.id} currentStatus={enquiry.status} />
                </td>
                <td className="px-4 py-4 text-muted">{formatDateIST(enquiry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {enquiries.length === 0 && <p className="p-8 text-center text-muted">{emptyMessage}</p>}
      </div>

      <AdminPager
        page={pageWindow.page}
        totalPages={pageWindow.totalPages}
        total={pageWindow.total}
        noun="enquiries"
        hrefForPage={hrefForPage}
        label="Contact enquiry pagination"
      />
    </div>
  );
}
