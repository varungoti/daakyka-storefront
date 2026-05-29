import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminContactEnquiriesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  const enquiries = await db.contactEnquiry.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Contact Enquiries</h1>
        <p className="text-muted">General, institutional, and support messages from the contact form.</p>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-white">
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
                  <p className="text-muted">{enquiry.email}</p>
                  {enquiry.phone && <p className="text-muted">{enquiry.phone}</p>}
                  {enquiry.organization && (
                    <p className="mt-1 text-xs text-brand">{enquiry.organization}</p>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium">
                    {enquiry.type.replace("_", " ")}
                  </span>
                </td>
                <td className="max-w-xs px-4 py-4 text-muted">{enquiry.message}</td>
                <td className="px-4 py-4">{enquiry.status}</td>
                <td className="px-4 py-4 text-muted">
                  {enquiry.createdAt.toLocaleDateString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {enquiries.length === 0 && (
          <p className="p-8 text-center text-muted">No contact enquiries yet.</p>
        )}
      </div>
    </div>
  );
}
