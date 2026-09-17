import { redirect } from "next/navigation";
import { TemplateForm } from "@/components/admin/template-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewTemplatePage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Template</h1>
        <p className="text-muted">Create a reusable email or WhatsApp template for campaigns and journeys.</p>
      </div>
      <TemplateForm />
    </div>
  );
}
