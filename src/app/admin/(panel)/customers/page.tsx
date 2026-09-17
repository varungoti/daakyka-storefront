import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { CustomersTable } from "@/components/admin/customers-table";

export default async function AdminCustomersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "customers:view")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Customers</h1>
        <p className="text-muted">Registered storefront accounts (Phase D1) and their order activity.</p>
      </div>
      <CustomersTable />
    </div>
  );
}
