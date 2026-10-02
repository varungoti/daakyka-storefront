"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/**
 * F-315: the owner's "Export customer data" and "Erase personal data" for
 * one person — the data-principal rights the privacy policy promises, without
 * SQL. Used on a customer's own page (`mode: "customer"`, keyed by id) and on
 * Privacy requests (`mode: "lookup"`, by email / phone — for a guest buyer,
 * enquirer, bulk lead or subscriber with no account).
 *
 * Erasure is irreversible, so it takes the person's email typed out again.
 * Orders are anonymised, not deleted (tax records); one that is still being
 * fulfilled blocks it, and the form then offers an explicit override.
 */

type Props =
  | { mode: "customer"; customerId: string; email: string }
  | { mode: "lookup" };

interface EraseResult {
  counts: Record<string, number>;
}

const COUNT_LABELS: Record<string, string> = {
  ordersAnonymised: "orders anonymised (totals kept)",
  discountRedemptionsAnonymised: "discount redemptions anonymised",
  customers: "account deleted",
  contactEnquiries: "contact enquiries",
  bulkOrderLeads: "bulk enquiries",
  newsletterSubscribers: "newsletter subscriptions",
  whatsappOptIns: "WhatsApp opt-ins",
  backInStockSubscriptions: "back-in-stock sign-ups",
  journeyEnrollments: "journey enrolments",
  journeyEvents: "journey messages",
  campaignDeliveries: "campaign deliveries",
  emailOutbox: "emails in the log",
  emailOutboxMentions: "new-order alert emails blanked",
  cartAbandonmentEvents: "abandoned carts",
  orderEvents: "legacy order events",
  adminNotifications: "admin notifications",
};

function describeCounts(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${value} ${COUNT_LABELS[key] ?? key}`);
}

function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function PersonalDataTools(props: Props) {
  const router = useRouter();
  const baseId = useId();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [confirm, setConfirm] = useState("");
  const [includeOpenOrders, setIncludeOpenOrders] = useState(false);
  const [blockedOrders, setBlockedOrders] = useState<string[]>([]);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [busy, setBusy] = useState<"export" | "erase" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EraseResult | null>(null);

  const subjectEmail = props.mode === "customer" ? props.email : email.trim();
  const subjectPhone = props.mode === "lookup" ? phone.trim() : "";
  const hasSubject = props.mode === "customer" || Boolean(subjectEmail || subjectPhone);
  const expectedConfirmation = props.mode === "customer" ? props.email : subjectEmail || subjectPhone;

  async function readError(response: Response): Promise<string> {
    const data = (await response.json().catch(() => null)) as { error?: string; orders?: string[] } | null;
    if (response.status === 409 && data?.orders?.length) setBlockedOrders(data.orders);
    return data?.error ?? "Something went wrong. Please try again.";
  }

  async function exportLookup() {
    setBusy("export");
    setError("");
    try {
      const response = await fetch("/api/admin/privacy/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(subjectEmail ? { email: subjectEmail } : {}), ...(subjectPhone ? { phone: subjectPhone } : {}) }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      downloadJson(await response.text(), "personal-data-export.json");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function erase(event: React.FormEvent) {
    event.preventDefault();
    setBusy("erase");
    setError("");
    setResult(null);
    try {
      const response =
        props.mode === "customer"
          ? await fetch(`/api/admin/customers/${props.customerId}/erase`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirmEmail: confirm, includeOpenOrders }),
            })
          : await fetch("/api/admin/privacy/erase", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(subjectEmail ? { email: subjectEmail } : {}),
                ...(subjectPhone ? { phone: subjectPhone } : {}),
                confirm,
                includeOpenOrders,
              }),
            });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const data = (await response.json()) as EraseResult;
      setResult(data);
      setEraseOpen(false);
      setConfirm("");
      if (props.mode === "customer") {
        // The customer page no longer exists.
        router.push("/admin/customers");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const buttonBase = "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";

  return (
    <div className="space-y-4">
      {props.mode === "lookup" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${baseId}-email`} className="mb-1 block text-sm font-semibold text-ink">
              Email address
            </label>
            <input
              id={`${baseId}-email`}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label htmlFor={`${baseId}-phone`} className="mb-1 block text-sm font-semibold text-ink">
              Phone number <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={`${baseId}-phone`}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="off"
              className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {props.mode === "customer" ? (
          <a
            href={`/api/admin/customers/${props.customerId}/export`}
            download
            className={`${buttonBase} border border-border text-ink hover:bg-alt-surface`}
          >
            Export customer data
          </a>
        ) : (
          <button
            type="button"
            onClick={exportLookup}
            disabled={!hasSubject || busy !== null}
            className={`${buttonBase} border border-border text-ink hover:bg-alt-surface`}
          >
            {busy === "export" ? "Preparing…" : "Export data"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setEraseOpen((open) => !open);
            setError("");
            setResult(null);
          }}
          disabled={!hasSubject || busy !== null}
          aria-expanded={eraseOpen}
          className={`${buttonBase} border border-red-300 text-red-700 hover:bg-red-50`}
        >
          Erase personal data
        </button>
      </div>

      {eraseOpen && (
        <form onSubmit={erase} className="space-y-3 rounded-2xl border border-red-200 bg-red-50/40 p-4">
          <p className="text-sm text-ink">
            This permanently removes this person&apos;s account, enquiries, subscriptions, journey and email-log rows and
            admin alerts that quote their address. Their orders are kept for tax records but anonymised (name,
            email, phone and street address removed; totals, items and invoice numbers stay). It cannot be undone —
            export their data first if you need a copy.
          </p>
          <div>
            <label htmlFor={`${baseId}-confirm`} className="mb-1 block text-sm font-semibold text-ink">
              Type <span className="font-mono">{expectedConfirmation}</span> to confirm
            </label>
            <input
              id={`${baseId}-confirm`}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              required
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
            />
          </div>
          {blockedOrders.length > 0 && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={includeOpenOrders}
                onChange={(event) => setIncludeOpenOrders(event.target.checked)}
                className="mt-1"
              />
              <span>
                Erase anyway, even though {blockedOrders.join(", ")} {blockedOrders.length === 1 ? "is" : "are"} still
                being processed.
              </span>
            </label>
          )}
          <button
            type="submit"
            disabled={busy !== null || confirm.trim().toLowerCase() !== expectedConfirmation.toLowerCase()}
            className={`${buttonBase} bg-red-600 text-white hover:bg-red-700`}
          >
            {busy === "erase" ? "Erasing…" : "Permanently erase"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="rounded-xl border border-border bg-surface p-3 text-sm text-ink">
          <p className="font-semibold">Erased.</p>
          {describeCounts(result.counts).length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {describeCounts(result.counts).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nothing was found for that person.</p>
          )}
        </div>
      )}
    </div>
  );
}
