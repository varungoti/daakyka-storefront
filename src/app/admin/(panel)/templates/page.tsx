import { DeleteButton } from "@/components/admin/delete-button";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { listTemplatesForAdmin } from "@/lib/engagement/templates";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function TemplatesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const templates = await listTemplatesForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Message Templates</h1>
          <p className="text-muted">Reusable email and WhatsApp templates for customer journeys.</p>
        </div>
        <Link
          href="/admin/templates/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Template
        </Link>
      </div>

      <div className="space-y-4">
        {templates.map((template) => (
          <article key={template.id} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-lg font-bold text-ink">{template.name}</p>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold uppercase text-brand">
                  {template.channel}
                </span>
                <Link
                  href={`/admin/templates/${template.id}`}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
                >
                  Edit
                </Link>
                <DeleteButton
                  href={`/api/admin/templates/${template.id}`}
                  confirmMessage={`Delete the "${template.name}" template?`}
                />
              </div>
            </div>
            {template.subject && <p className="mt-2 text-sm font-medium text-ink">Subject: {template.subject}</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">{template.body}</p>
          </article>
        ))}
        {templates.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted">
            No templates yet.
          </p>
        )}
      </div>
    </div>
  );
}
