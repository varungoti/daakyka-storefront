import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { CustomersTable } from "@/components/admin/customers-table";
import { GuestBuyersTable } from "@/components/admin/guest-buyers-table";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Customers" };

export default async function AdminCustomersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "customers:view")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Customers</h1>
        {/* F-198 fix: this used to say "Registered storefront accounts
            (Phase D1)", which both leaked an internal phase label and
            described the page inaccurately once guest buyers (below) were
            added — most orders at this store are guest checkouts. */}
        <p className="text-muted">Registered customer accounts and their order activity.</p>
      </div>
      <CustomersTable />

      <div>
        <h2 className="font-display text-xl font-bold text-ink">Guest buyers</h2>
        <p className="text-muted">
          Orders placed without creating an account. They&apos;ll move into the list above once the
          buyer registers or logs in with the same email.
        </p>
      </div>
      <GuestBuyersTable />
    </div>
  );
}
