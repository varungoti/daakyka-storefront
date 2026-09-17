import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

/**
 * Placeholder — the full media library (grid of every MediaAsset, filters
 * by usage/source, replace/regenerate, "which products use this") is a
 * separate task. This page exists so the "Media" nav link resolves and
 * still enforces `media:manage`.
 */
export default async function AdminMediaPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "media:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Media Library</h1>
        <p className="text-muted">The full media library is coming next.</p>
      </div>
      <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        Uploads and AI generation already work from the Categories editor — a dedicated grid with
        filters, replace, and regenerate ships in the next phase.
      </div>
    </div>
  );
}
