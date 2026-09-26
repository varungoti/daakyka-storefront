import { BulkLeadStatusSelect } from "@/components/admin/bulk-lead-status-select";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminBulkOrdersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  const leads = await db.bulkOrderLead.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Bulk Order Manager</h1>
        <p className="text-muted">Hospital and team uniform enquiries from the storefront.</p>
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
                  <a href={`tel:${lead.phone}`} className="block text-muted hover:text-brand hover:underline">
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
                  <BulkLeadStatusSelect leadId={lead.id} currentStatus={lead.status} />
                </td>
                <td className="px-4 py-4 text-muted">
                  {lead.createdAt.toLocaleDateString("en-IN")}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="p-8 text-center text-muted">No bulk enquiries captured yet.</p>
        )}
      </div>

      {/* Mobile/tablet stacked-card layout (below `lg`). */}
      <div className="space-y-3 lg:hidden">
        {leads.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-8 text-center text-muted">No bulk enquiries captured yet.</p>
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
                    <a href={`tel:${lead.phone}`} className="text-muted hover:text-brand hover:underline">
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
                <BulkLeadStatusSelect leadId={lead.id} currentStatus={lead.status} />
                <span className="shrink-0 text-xs text-muted">{lead.createdAt.toLocaleDateString("en-IN")}</span>
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** wa.me needs a bare, country-coded digit string — strips everything
 * else and, for a 10-digit Indian mobile with no country code typed,
 * prefixes 91. Returns null when what's left doesn't look like a usable
 * number, so no dead WhatsApp link is ever rendered. */
function whatsappLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  if (withCountryCode.length < 11 || withCountryCode.length > 15) return null;
  return `https://wa.me/${withCountryCode}`;
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
