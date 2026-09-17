import { DeleteButton } from "@/components/admin/delete-button";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getAllTestimonialsForAdmin } from "@/lib/testimonials";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminTestimonialsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "testimonials:manage")) {
    redirect("/admin/dashboard");
  }

  const testimonials = await getAllTestimonialsForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Testimonial Manager</h1>
          <p className="text-muted">Manage customer quotes shown on the homepage and shop.</p>
        </div>
        <Link
          href="/admin/testimonials/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Testimonial
        </Link>
      </div>

      <div className="space-y-4">
        {testimonials.map((t) => (
          <article key={t.id} className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full">
              <Image src={t.avatar} alt={t.name} fill className="object-cover" sizes="64px" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-ink">{t.name}</p>
                <span className="text-sm text-muted">{t.title}</span>
                {t.featured && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">
                    Featured
                  </span>
                )}
                {!t.active && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">
                    Hidden
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">&ldquo;{t.quote}&rdquo;</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Link
                href={`/admin/testimonials/${t.id}`}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
              >
                Edit
              </Link>
              <DeleteButton
                href={`/api/admin/testimonials/${t.id}`}
                confirmMessage={`Delete the testimonial from ${t.name}?`}
              />
            </div>
          </article>
        ))}
        {testimonials.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted">
            No testimonials yet.
          </p>
        )}
      </div>
    </div>
  );
}
