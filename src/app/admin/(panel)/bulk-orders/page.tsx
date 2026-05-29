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

      <div className="overflow-x-auto rounded-3xl border border-border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Staff</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-border/70 align-top">
                <td className="px-4 py-4">
                  <p className="font-semibold text-ink">{lead.organization}</p>
                  <p className="text-muted">{lead.city ?? "—"}</p>
                  {lead.notes && <p className="mt-2 max-w-xs text-xs text-muted">{lead.notes}</p>}
                </td>
                <td className="px-4 py-4">
                  <p>{lead.contactPerson}</p>
                  <p className="text-muted">{lead.email}</p>
                  <p className="text-muted">{lead.phone}</p>
                </td>
                <td className="px-4 py-4">{lead.staffCount ?? "—"}</td>
                <td className="px-4 py-4">
                  <BulkLeadStatusSelect leadId={lead.id} currentStatus={lead.status} />
                </td>
                <td className="px-4 py-4 text-muted">
                  {lead.createdAt.toLocaleDateString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="p-8 text-center text-muted">No bulk enquiries captured yet.</p>
        )}
      </div>
    </div>
  );
}
