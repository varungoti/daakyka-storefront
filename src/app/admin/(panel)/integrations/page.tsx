import { IntegrationToggle } from "@/components/admin/integration-toggle";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getIntegrationStatuses } from "@/lib/integrations/status";
import { redirect } from "next/navigation";

export default async function AdminIntegrationsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "integrations:manage")) {
    redirect("/admin/dashboard");
  }

  const envStatuses = getIntegrationStatuses();
  const dbSettings = await db.integrationSetting.findMany();
  const settingsMap = Object.fromEntries(dbSettings.map((s) => [s.provider, s]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Integrations</h1>
        <p className="text-muted">
          Connect external providers via environment variables. Toggle readiness flags in admin;
          secrets stay in server env only.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {envStatuses.map((item) => {
          const dbSetting = settingsMap[item.provider];
          const enabled = dbSetting?.enabled ?? item.status === "configured";
          return (
            <article key={item.provider} className="rounded-3xl border border-border bg-white p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">{item.label}</h2>
                  <p className="mt-1 text-sm text-muted">{item.hint}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <IntegrationToggle
                  provider={item.provider}
                  enabled={enabled}
                  configured={item.status === "configured"}
                />
                <span className="rounded-full bg-lavender/40 px-3 py-1 font-mono text-muted">
                  {envVarHint(item.provider)}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <section className="rounded-3xl border border-border bg-lavender/30 p-6 text-sm text-muted">
        <p className="font-semibold text-ink">Setup</p>
        <p className="mt-2">
          Copy <code className="rounded bg-white px-1.5 py-0.5">.env.local.example</code> to{" "}
          <code className="rounded bg-white px-1.5 py-0.5">.env.local</code> and add provider
          keys. Restart the dev server after changes.
        </p>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "configured"
      ? "bg-trust/15 text-trust"
      : status === "disabled"
        ? "bg-lavender/60 text-muted"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${styles}`}>
      {status}
    </span>
  );
}

function envVarHint(provider: string): string {
  const map: Record<string, string> = {
    SHOPIFY: "NEXT_PUBLIC_SHOPIFY_*",
    BREVO: "BREVO_API_KEY",
    WATI: "WATI_API_KEY",
    HERMES: "HERMES_LOCAL_URL or HERMES_API_URL",
  };
  return map[provider] ?? provider;
}
