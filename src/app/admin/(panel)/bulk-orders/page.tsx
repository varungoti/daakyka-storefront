import { BulkLeadStatusSelect } from "@/components/admin/bulk-lead-status-select";
import { AdminPager } from "@/components/admin/pager";
import {
  BULK_LEAD_STATUS_FILTERS,
  BULK_LEADS_PAGE_SIZE,
  parseBulkLeadStatusFilter,
  telHref,
  whatsappLink,
} from "@/lib/admin/bulk-leads";
import { adminListHref, getPageWindow, parsePageParam, type RawSearchParam } from "@/lib/admin/pagination";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateIST } from "@/lib/format/datetime";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Bulk Enquiries" };

interface PageProps {
  searchParams: Promise<{ page?: RawSearchParam; status?: RawSearchParam }>;
}

export default async function AdminBulkOrdersPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  // F-196: this used to load every lead (45+ and growing) in one unpaginated
  // list — a 13,000px page on a phone. Same `?page=` + `?status=` shape as
  // the Contact Enquiries list, so the owner can work through just the NEW
  // leads and page through the rest.
  const rawParams = await searchParams;
  const statusFilter = parseBulkLeadStatusFilter(rawParams.status);
  const where = statusFilter ? { status: statusFilter } : {};

  const [total, statusGroups] = await Promise.all([
    db.bulkOrderLead.count({ where }),
    db.bulkOrderLead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const pageWindow = getPageWindow(parsePageParam(rawParams.page), total, BULK_LEADS_PAGE_SIZE);
  const leads = await db.bulkOrderLead.findMany({
    where,
    // `id` breaks createdAt ties so a lead can never repeat or vanish across
    // a page boundary.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pageWindow.skip,
    take: pageWindow.take,
  });
  const countFor = (status: string) => statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const allCount = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
  const hrefForPage = (page: number) => adminListHref("/admin/bulk-orders", { status: statusFilter, page });
  const emptyMessage = statusFilter ? "No enquiries with this status." : "No bulk enquiries captured yet.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Bulk Order Manager</h1>
        <p className="text-muted">Hospital and team uniform enquiries from the storefront.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-semibold" role="group" aria-label="Filter by status">
        <Link
          href="/admin/bulk-orders"
          aria-current={statusFilter ? undefined : "true"}
          className={`rounded-full border px-3 py-1.5 ${statusFilter ? "border-border text-muted hover:bg-lilac/40" : "border-brand bg-brand/10 text-brand"}`}
        >
          All ({allCount})
        </Link>
        {BULK_LEAD_STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={adminListHref("/admin/bulk-orders", { status: filter.value })}
            aria-current={statusFilter === filter.value ? "true" : undefined}
            className={`rounded-full border px-3 py-1.5 ${statusFilter === filter.value ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-lilac/40"}`}
          >
            {filter.label} ({countFor(filter.value)})
          </Link>
        ))}
      </div>

      {/* F-05 (docs/audit-2026-09-19/admin-ux.md): desktop table unchanged,
          `lg` and up only — see the matching comment in products-table.tsx
          for why `lg` (matching the sidebar's own hamburger breakpoint) was
          chosen over the more common `sm`. */}
      <div className="hidden overflow-x-auto rounded-3xl border border-border bg-surface lg:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Staff</th>
              <th className="px-4 py-3">Type / Interests</th>
              {/* F-196: what the lead actually asked for — was nowhere on
                  this page even though the storefront form collects it. */}
              <th className="px-4 py-3">Requirements</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const wa = whatsappLink(lead.phone);
              return (
              <tr key={lead.id} className="border-b border-border/70 align-top">
                <td className="px-4 py-4">
                  <p className="font-semibold text-ink">{lead.organization}</p>
                  <p className="text-muted">{lead.city ?? "—"}</p>
                  {lead.notes && <p className="mt-2 max-w-xs whitespace-pre-line break-words text-xs text-muted">{lead.notes}</p>}
                </td>
                <td className="px-4 py-4">
                  <p>{lead.contactPerson}</p>
                  <a href={`mailto:${lead.email}`} className="block text-brand hover:underline">
                    {lead.email}
                  </a>
                  <a href={telHref(lead.phone)} className="block text-muted hover:text-brand hover:underline">
                    {lead.phone}
                  </a>
                  {wa && (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-trust hover:underline"
                    >
                      WhatsApp
                    </a>
                  )}
                </td>
                <td className="px-4 py-4">{lead.staffCount ?? "—"}</td>
                <td className="px-4 py-4">
                  <p className="text-ink">{lead.organizationType ?? "—"}</p>
                  {lead.categoryInterest.length > 0 && (
                    <p className="mt-1 max-w-xs text-xs text-muted">
                      {lead.categoryInterest.join(", ")}
                    </p>
                  )}
                </td>
                <td className="max-w-xs px-4 py-4">
                  <BulkOrderRequirements lead={lead} />
                </td>
                <td className="px-4 py-4">
                  <BulkLeadStatusSelect leadId={lead.id} leadName={lead.organization} currentStatus={lead.status} />
                </td>
                <td className="px-4 py-4 text-muted">
                  {formatDateIST(lead.createdAt)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="p-8 text-center text-muted">{emptyMessage}</p>
        )}
      </div>

      {/* Mobile/tablet stacked-card layout (below `lg`). */}
      <div className="space-y-3 lg:hidden">
        {leads.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-8 text-center text-muted">{emptyMessage}</p>
        ) : (
          leads.map((lead) => {
            const wa = whatsappLink(lead.phone);
            return (
            <div key={lead.id} className="rounded-2xl border border-border bg-surface p-4">
              <p className="font-semibold text-ink">{lead.organization}</p>
              <p className="text-xs text-muted">{lead.city ?? "—"}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 text-xs">
                <div>
                  <dt className="text-muted">Contact</dt>
                  <dd className="text-ink">{lead.contactPerson}</dd>
                  <dd>
                    <a href={`mailto:${lead.email}`} className="text-brand hover:underline">
                      {lead.email}
                    </a>
                  </dd>
                  <dd>
                    <a href={telHref(lead.phone)} className="text-muted hover:text-brand hover:underline">
                      {lead.phone}
                    </a>
                  </dd>
                  {wa && (
                    <dd>
                      <a
                        href={wa}
                        target="_blank"
                        rel="noreferrer"
                        className="text-trust hover:underline"
                      >
                        WhatsApp
                      </a>
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-muted">Staff</dt>
                  <dd className="text-ink">{lead.staffCount ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted">Type / Interests</dt>
                  <dd className="text-ink">{lead.organizationType ?? "—"}</dd>
                  {lead.categoryInterest.length > 0 && <dd className="text-muted">{lead.categoryInterest.join(", ")}</dd>}
                </div>
                <div className="col-span-2">
                  <dt className="text-muted">Requirements</dt>
                  <BulkOrderRequirements lead={lead} asDl />
                </div>
              </dl>
              {lead.notes && <p className="mt-2 whitespace-pre-line break-words text-xs text-muted">{lead.notes}</p>}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <BulkLeadStatusSelect leadId={lead.id} leadName={lead.organization} currentStatus={lead.status} />
                <span className="shrink-0 text-xs text-muted">{formatDateIST(lead.createdAt)}</span>
              </div>
            </div>
            );
          })
        )}
      </div>

      <AdminPager
        page={pageWindow.page}
        totalPages={pageWindow.totalPages}
        total={pageWindow.total}
        noun="enquiries"
        hrefForPage={hrefForPage}
        label="Bulk enquiry pagination"
      />
    </div>
  );
}

type BulkOrderLeadRequirements = {
  productsRequired: string | null;
  sizesRequired: string | null;
  colorsRequired: string | null;
  logoEmbroidery: boolean;
  deliveryTimeline: string | null;
};

/** F-196: renders whatever the lead actually filled in — products,
 * sizes, colours, logo embroidery, delivery timeline — none of which
 * this page showed before. Free text up to 500 chars each, so it wraps
 * rather than overflowing a fixed-width cell. */
function BulkOrderRequirements({ lead, asDl }: { lead: BulkOrderLeadRequirements; asDl?: boolean }) {
  const rows: Array<[string, string]> = [];
  if (lead.productsRequired) rows.push(["Products", lead.productsRequired]);
  if (lead.sizesRequired) rows.push(["Sizes", lead.sizesRequired]);
  if (lead.colorsRequired) rows.push(["Colours", lead.colorsRequired]);
  if (lead.deliveryTimeline) rows.push(["Delivery", lead.deliveryTimeline]);
  if (lead.logoEmbroidery) rows.push(["Logo embroidery", "Yes"]);

  if (rows.length === 0) {
    return asDl ? (
      <dd className="text-muted">No requirements given</dd>
    ) : (
      <p className="text-muted">No requirements given</p>
    );
  }

  if (asDl) {
    return (
      <>
        {rows.map(([label, value]) => (
          <dd key={label} className="text-ink">
            <span className="text-muted">{label}:</span> <span className="whitespace-pre-line break-words">{value}</span>
          </dd>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <p key={label} className="text-xs text-ink">
          <span className="text-muted">{label}:</span> <span className="whitespace-pre-line break-words">{value}</span>
        </p>
      ))}
    </div>
  );
}
