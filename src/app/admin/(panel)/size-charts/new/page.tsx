import { redirect } from "next/navigation";
import { SizeChartForm } from "@/components/admin/size-chart-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewSizeChartPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "categories:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Size Chart</h1>
        <p className="text-muted">Build a table of sizes and measurements.</p>
      </div>
      <SizeChartForm />
    </div>
  );
}
