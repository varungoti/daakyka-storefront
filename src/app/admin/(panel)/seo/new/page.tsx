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
          Add a title/meta description override for a page path. Home (/) and Shop (/shop) are
          read live by the storefront; other paths are recorded for reference.
        </p>
      </div>
      <SeoRecordForm />
    </div>
  );
}
