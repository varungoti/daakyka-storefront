import { DeleteButton } from "@/components/admin/delete-button";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { listSegmentsForAdmin } from "@/lib/engagement/segments";
import { resolveSegmentRecipients } from "@/lib/engagement/segment-resolver";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function SegmentsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const segments = await listSegmentsForAdmin();
  // F-217: the raw-JSON criteria editor gave no feedback on how many people
  // a segment actually resolves to — a segment that (validly, or before the
  // stricter schema) matched nobody looked identical to one with real
  // reach. Showing the live count here doesn't require touching
  // segment-resolver.ts itself, just calling the same function a campaign
  // send already relies on.
  const recipientCounts = await Promise.all(
    segments.map((segment) => resolveSegmentRecipients(segment.id).then((r) => r.length)),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Customer Segments</h1>
          <p className="text-muted">Audience groups for targeted email and WhatsApp campaigns.</p>
        </div>
        <Link
          href="/admin/segments/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Segment
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {segments.map((segment, index) => {
          const recipientCount = recipientCounts[index];
          return (
            <article key={segment.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-lg font-bold text-ink">{segment.name}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">{segment.slug}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/admin/segments/${segment.id}`}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
                  >
                    Edit
                  </Link>
                  <DeleteButton
                    href={`/api/admin/segments/${segment.id}`}
                    confirmMessage={`Delete the "${segment.name}" segment?`}
                  />
                </div>
              </div>
              <p className={`mt-2 text-sm font-semibold ${recipientCount === 0 ? "text-amber-700" : "text-trust"}`}>
                {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"} today
                {recipientCount === 0 ? " — check the criteria below" : ""}
              </p>
              {segment.description && <p className="mt-1 text-sm text-muted">{segment.description}</p>}
              <pre className="mt-3 overflow-x-auto rounded-xl bg-lavender/40 p-3 text-xs text-muted">
                {segment.criteria}
              </pre>
            </article>
          );
        })}
        {segments.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-border p-8 text-center text-muted">
            No segments yet.
          </p>
        )}
      </div>
    </div>
  );
}
