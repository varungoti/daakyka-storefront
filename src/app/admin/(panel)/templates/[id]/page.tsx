import { notFound, redirect } from "next/navigation";
import { TemplateForm } from "@/components/admin/template-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getTemplateForAdmin, TemplateNotFoundError } from "@/lib/engagement/templates";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const template = await getTemplateForAdmin(id).catch((err) => {
    if (err instanceof TemplateNotFoundError) return null;
    throw err;
  });

  if (!template) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Template</h1>
        <p className="text-muted">{template.name}</p>
      </div>
      <TemplateForm initial={template} />
    </div>
  );
}
