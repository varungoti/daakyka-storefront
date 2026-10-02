import { PersonalDataTools } from "@/components/admin/personal-data-tools";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { RETENTION_RULES, formatRetentionPeriod } from "@/lib/privacy/retention";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Requests" };

/**
 * F-315 / F-316: where the owner answers a data-principal request for
 * someone who has no customer account (a guest buyer, an enquirer, a bulk
 * lead, a newsletter subscriber) — customers with an account have the same
 * tools on their own page — and where the retention schedule the daily job
 * enforces is written down in plain words.
 */
export default async function AdminPrivacyRequestsPage() {
  await requireAdminPage("privacy:manage");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Privacy requests</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Our privacy policy promises that anyone can ask to see, correct or delete their data. Look the person up by
          email (and phone, if you have it) to export everything we hold about them, or erase it. Customers with an
          account can also do this themselves from their profile.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Look up a person</h2>
        <PersonalDataTools mode="lookup" />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">How long we keep data</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">
          A daily job removes or anonymises data once it is older than the limits below. These are the defaults the
          code enforces and the privacy policy publishes — have them confirmed by your legal adviser (the order
          period in particular follows your GST record-keeping obligations).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Retention schedule</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Data
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Kept for
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Then
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {RETENTION_RULES.map((rule) => (
                <tr key={rule.id}>
                  <td className="py-2 pr-4 text-ink">{rule.subject}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-ink">{rule.maxAgeDays === 0 ? "Not kept readable" : formatRetentionPeriod(rule.maxAgeDays)}</td>
                  <td className="py-2 whitespace-nowrap text-muted">
                    {rule.action === "delete" ? "Deleted" : "Anonymised"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
