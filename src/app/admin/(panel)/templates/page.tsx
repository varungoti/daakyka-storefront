import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function TemplatesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const templates = await db.messageTemplate.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Message Templates</h1>
        <p className="text-muted">Reusable email and WhatsApp templates for customer journeys.</p>
      </div>

      <div className="space-y-4">
        {templates.map((template) => (
          <article key={template.id} className="rounded-2xl border border-border bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-lg font-bold text-ink">{template.name}</p>
              <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold uppercase text-brand">
                {template.channel}
              </span>
            </div>
            {template.subject && <p className="mt-2 text-sm font-medium text-ink">Subject: {template.subject}</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">{template.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
