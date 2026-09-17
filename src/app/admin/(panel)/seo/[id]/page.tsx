import { notFound, redirect } from "next/navigation";
import { SeoRecordForm } from "@/components/admin/seo-record-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getSeoRecordForAdmin, SeoPageRecordNotFoundError } from "@/lib/seo/records";

export default async function EditSeoRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "seo:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const record = await getSeoRecordForAdmin(id).catch((err) => {
    if (err instanceof SeoPageRecordNotFoundError) return null;
    throw err;
  });

  if (!record) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit SEO Override</h1>
        <p className="text-muted">{record.path}</p>
      </div>
      <SeoRecordForm initial={record} />
    </div>
  );
}
