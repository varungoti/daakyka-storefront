import { notFound, redirect } from "next/navigation";
import { SizeChartForm } from "@/components/admin/size-chart-form";
import { getSizeChartForAdmin, SizeChartNotFoundError } from "@/lib/catalog/size-charts";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function EditSizeChartPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "categories:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const sizeChart = await getSizeChartForAdmin(id).catch((err) => {
    if (err instanceof SizeChartNotFoundError) return null;
    throw err;
  });

  if (!sizeChart) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Size Chart</h1>
        <p className="text-muted">{sizeChart.name}</p>
      </div>
      <SizeChartForm initial={sizeChart} />
    </div>
  );
}
