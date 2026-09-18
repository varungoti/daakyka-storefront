import { redirect } from "next/navigation";
import {
  IntegrationCredentialForm,
  type CredentialFieldState,
} from "@/components/admin/integration-credential-form";
import { IntegrationToggle } from "@/components/admin/integration-toggle";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  CREDENTIAL_FIELDS,
  getCredential,
  getCredentialMeta,
  type CredentialProvider,
} from "@/lib/integrations/credential-store";
import { getIntegrationStatuses } from "@/lib/integrations/status";

// Only these providers have the DB-backed enable/disable toggle
// (src/lib/integrations/enabled.ts); Razorpay's "readiness" is derived
// purely from whether its credentials are set, so it has no separate
// enabled flag to toggle.
const toggleableProviders = new Set(["SHOPIFY", "BREVO", "WATI", "HERMES"]);

async function buildFieldStates(provider: CredentialProvider): Promise<CredentialFieldState[]> {
  return Promise.all(
    CREDENTIAL_FIELDS[provider].map(async (field) => {
      const meta = await getCredentialMeta(provider, field.key);
      const currentValue =
        !field.secret && meta.configured ? await getCredential(provider, field.key) : undefined;
      return {
        key: field.key,
        label: field.label,
        secret: field.secret,
        configured: meta.configured,
        updatedAt: meta.updatedAt,
        updatedByName: meta.updatedByName,
        currentValue: currentValue ?? undefined,
      };
    }),
  );
}

export default async function AdminIntegrationsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "integrations:manage")) {
    redirect("/admin/dashboard");
  }

  const [envStatuses, dbSettings, razorpayFields, brevoFields] = await Promise.all([
    getIntegrationStatuses(),
    db.integrationSetting.findMany(),
    buildFieldStates("RAZORPAY"),
    buildFieldStates("BREVO"),
  ]);
  const settingsMap = Object.fromEntries(dbSettings.map((s) => [s.provider, s]));
  const credentialFieldsByProvider: Record<CredentialProvider, CredentialFieldState[]> = {
    RAZORPAY: razorpayFields,
    BREVO: brevoFields,
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Integrations</h1>
        <p className="text-muted">
          Connect external providers by pasting credentials below, or via environment variables at
          deploy time — a value set here always takes priority. Secrets are encrypted at rest and
          never shown again once saved.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {envStatuses.map((item) => {
          const dbSetting = settingsMap[item.provider];
          // No row means no admin has opted in yet — matches
          // isIntegrationEnabled()'s default-to-disabled behavior, so
          // this toggle never shows "enabled" for something that would
          // actually be treated as disabled when sending.
          const enabled = dbSetting?.enabled ?? false;
          return (
            <article key={item.provider} className="rounded-3xl border border-border bg-surface-elevated p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">{item.label}</h2>
                  <p className="mt-1 text-sm text-muted">{item.hint}</p>
                </div>
                <StatusBadge status={item.status} source={item.source} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                {toggleableProviders.has(item.provider) ? (
                  <IntegrationToggle
                    provider={item.provider}
                    enabled={enabled}
                    configured={item.status === "configured"}
                  />
                ) : null}
                <span className="rounded-full bg-lavender/40 px-3 py-1 font-mono text-muted">
                  {envVarHint(item.provider)}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Credentials</h2>
          <p className="text-sm text-muted">
            Paste real Razorpay and Brevo credentials here — no redeploy needed. Clearing a
            credential falls back to its environment variable, if one is set.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Razorpay</h3>
            <IntegrationCredentialForm provider="RAZORPAY" fields={credentialFieldsByProvider.RAZORPAY} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Brevo</h3>
            <IntegrationCredentialForm provider="BREVO" fields={credentialFieldsByProvider.BREVO} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-lavender/30 p-6 text-sm text-muted">
        <p className="font-semibold text-ink">Setup</p>
        <p className="mt-2">
          Prefer environment variables instead? Copy{" "}
          <code className="rounded bg-surface-elevated px-1.5 py-0.5">.env.local.example</code> to{" "}
          <code className="rounded bg-surface-elevated px-1.5 py-0.5">.env.local</code> and add
          provider keys, then restart the dev server. A credential set above always overrides its
          environment variable.
        </p>
      </section>
    </div>
  );
}

function StatusBadge({ status, source }: { status: string; source?: string }) {
  const styles =
    status === "configured"
      ? "bg-trust/15 text-trust"
      : status === "disabled"
        ? "bg-lavender/60 text-muted"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${styles}`}>
      {status}
      {source ? ` (${source})` : ""}
    </span>
  );
}

function envVarHint(provider: string): string {
  const map: Record<string, string> = {
    SHOPIFY: "NEXT_PUBLIC_SHOPIFY_*",
    BREVO: "BREVO_API_KEY",
    WATI: "WATI_API_KEY",
    HERMES: "HERMES_LOCAL_URL or HERMES_API_URL",
    RAZORPAY: "RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET",
  };
  return map[provider] ?? provider;
}
