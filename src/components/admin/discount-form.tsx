"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DiscountFormInitial {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minSubtotal: number | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  /** yyyy-mm-dd, or null — pre-formatted by the page for the date input. */
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  redeemedCount: number;
}

/** Empty string in a numeric field means "not set" (null) — this form
 * treats every optional numeric/date field that way rather than 0, since 0
 * is a meaningful, different value for minSubtotal. */
function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function DiscountForm({ initial }: { initial?: DiscountFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [code, setCode] = useState(initial?.code ?? "");
  const [type, setType] = useState<"PERCENTAGE" | "FIXED">(initial?.type ?? "PERCENTAGE");
  const [value, setValue] = useState(initial ? String(initial.value) : "");
  const [minSubtotal, setMinSubtotal] = useState(initial?.minSubtotal != null ? String(initial.minSubtotal) : "");
  const [maxRedemptions, setMaxRedemptions] = useState(
    initial?.maxRedemptions != null ? String(initial.maxRedemptions) : "",
  );
  const [maxRedemptionsPerCustomer, setMaxRedemptionsPerCustomer] = useState(
    initial?.maxRedemptionsPerCustomer != null ? String(initial.maxRedemptionsPerCustomer) : "",
  );
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? "");
  const [active, setActive] = useState(initial?.active ?? true);

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // F-038: the server now returns `issues: [{path, message}]` alongside
  // `error` (the first issue's own message) — previously the form threw
  // `issues` away and showed only the generic fallback string, so a PATCH
  // like `{code: "HERO 10"}` surfaced as "Validation failed" instead of
  // pointing at the code field specifically.
  const [fieldIssues, setFieldIssues] = useState<{ path: (string | number)[]; message: string }[]>([]);

  function fieldError(name: string): string | undefined {
    return fieldIssues.find((issue) => issue.path[0] === name)?.message;
  }

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldIssues([]);

    const payload = {
      code: code.trim(),
      type,
      value: Number(value),
      minSubtotal: toNullableNumber(minSubtotal),
      maxRedemptions: toNullableNumber(maxRedemptions),
      maxRedemptionsPerCustomer: toNullableNumber(maxRedemptionsPerCustomer),
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      active,
    };

    const response = await fetch(isEdit ? `/api/admin/discounts/${initial!.id}` : "/api/admin/discounts", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body?.error ?? "Couldn't save — check the fields above.");
      setFieldIssues(Array.isArray(body?.issues) ? body.issues : []);
      return;
    }

    router.push("/admin/discounts");
    router.refresh();
  };

  const canSubmit =
    code.trim().length >= 3 &&
    Number(value) > 0 &&
    (type !== "PERCENTAGE" || Number(value) <= 100) &&
    status !== "saving";

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          hint="Case-insensitive — stored and matched in UPPERCASE, e.g. HERO10"
          error={fieldError("code")}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="HERO10"
            aria-invalid={Boolean(fieldError("code"))}
            className="w-full rounded-xl border border-border p-2.5 font-mono text-sm uppercase text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "PERCENTAGE" | "FIXED")}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          >
            <option value="PERCENTAGE">Percentage off</option>
            <option value="FIXED">Fixed amount off (₹)</option>
          </select>
        </Field>
      </div>

      <Field
        label={type === "PERCENTAGE" ? "Value (% off, e.g. 10)" : "Value (₹ off)"}
        hint="Never applied for more than the order subtotal, however this is set."
        error={fieldError("value")}
      >
        <input
          type="number"
          min="0"
          // F-038: a UX nicety only — the Save button uses onClick, not a
          // form submit, so browser constraint validation never actually
          // runs here. The server's superRefine check (schemas.ts's
          // discountSchema) is the real guard against >100%.
          max={type === "PERCENTAGE" ? "100" : undefined}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={Boolean(fieldError("value"))}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minimum order subtotal (₹)" hint="Optional">
          <input
            type="number"
            min="0"
            step="0.01"
            value={minSubtotal}
            onChange={(e) => setMinSubtotal(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Total redemption cap" hint="Optional — across all customers">
          <input
            type="number"
            min="1"
            step="1"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Per-customer cap" hint="Optional — e.g. 1 for a first-purchase code">
          <input
            type="number"
            min="1"
            step="1"
            value={maxRedemptionsPerCustomer}
            onChange={(e) => setMaxRedemptionsPerCustomer(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valid from (IST)" hint="Optional — the whole day, from midnight IST" error={fieldError("startsAt")}>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            aria-invalid={Boolean(fieldError("startsAt"))}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Valid until (IST)" hint="Optional — through the whole day, until 11:59pm IST" error={fieldError("endsAt")}>
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            aria-invalid={Boolean(fieldError("endsAt"))}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (redeemable at checkout)
      </label>

      {isEdit && (
        <p className="rounded-xl bg-lavender/30 p-3 text-xs text-muted">
          Redeemed {initial!.redeemedCount} time{initial!.redeemedCount === 1 ? "" : "s"} so far
          {initial!.maxRedemptions != null ? ` of ${initial!.maxRedemptions} allowed` : ""}.
        </p>
      )}

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSubmit}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create discount code"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/discounts")}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
