import { redirect } from "next/navigation";
import { SeoRecordForm } from "@/components/admin/seo-record-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewSeoRecordPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "seo:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New SEO Override</h1>
        <p className="text-muted">
          Add a title/meta description override for Home (/) or Shop (/shop) — the only paths the
          storefront reads these overrides from live.
        </p>
      </div>
      <SeoRecordForm />
    </div>
  );
}
