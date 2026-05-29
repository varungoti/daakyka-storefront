import { JourneyStatusSelect } from "@/components/admin/journey-status-select";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminJourneysPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "journeys:manage")) {
    redirect("/admin/dashboard");
  }

  const journeys = await db.customerJourney.findMany({
    orderBy: { name: "asc" },
    include: {
      steps: {
        orderBy: { sortOrder: "asc" },
        include: { template: true },
      },
      _count: { select: { enrollments: true } },
    },
  });

  const enrollments = await db.journeyEnrollment.findMany({
    where: { status: "ACTIVE" },
    orderBy: { nextRunAt: "asc" },
    take: 15,
    include: { journey: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Customer Journeys</h1>
        <p className="text-muted">
          Automated email and WhatsApp sequences — journeys never auto-send without provider
          connection and campaign approval.
        </p>
      </div>

      <div className="space-y-6">
        {journeys.map((journey) => (
          <article key={journey.id} className="rounded-3xl border border-border bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand">
                  Trigger: {journey.trigger.replace(/_/g, " ")}
                </p>
                <h2 className="mt-1 font-display text-xl font-bold text-ink">{journey.name}</h2>
                <p className="mt-1 text-xs text-muted">{journey._count.enrollments} enrollments</p>
                {journey.description && (
                  <p className="mt-2 max-w-2xl text-sm text-muted">{journey.description}</p>
                )}
              </div>
              <JourneyStatusSelect journeyId={journey.id} currentStatus={journey.status} />
            </div>

            <ol className="mt-6 space-y-3">
              {journey.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-lavender/20 px-4 py-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                    {step.sortOrder + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{step.name}</p>
                    <p className="text-xs text-muted">
                      {step.channel.replace("_", " ")}
                      {step.delayHours > 0 && ` · +${step.delayHours}h`}
                      {step.template && ` · Template: ${step.template.name}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        ))}
        {journeys.length === 0 && (
          <p className="rounded-3xl border border-dashed border-border p-8 text-center text-muted">
            No journeys configured. Run database seed to load defaults.
          </p>
        )}
      </div>

      <section className="rounded-3xl border border-border bg-white p-6">
        <h2 className="font-display text-xl font-bold text-ink">Active Enrollments</h2>
        <ul className="mt-4 space-y-3">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
              <div>
                <p className="font-semibold text-ink">{enrollment.journey.name}</p>
                <p className="text-muted">
                  Step {enrollment.currentStep + 1} · {enrollment.email ?? enrollment.phone ?? "—"}
                </p>
              </div>
              <span className="text-xs text-muted">
                Next: {enrollment.nextRunAt?.toLocaleString("en-IN") ?? "—"}
              </span>
            </li>
          ))}
          {enrollments.length === 0 && (
            <p className="text-sm text-muted">No active enrollments — trigger a journey via newsletter or bulk order.</p>
          )}
        </ul>
      </section>
    </div>
  );
}
