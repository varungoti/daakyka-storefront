"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SettingKey } from "@/lib/settings";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes";
import { isDirty } from "@/lib/admin/is-dirty";
import { checkShippingInput } from "@/lib/admin/shipping-input";
import { formatApiError } from "@/lib/validation/format-api-error";

interface SaveSettingResult {
  ok: boolean;
  /** Populated on failure — the mapped, human-readable message from
   * formatApiError() (see src/lib/validation/format-api-error.ts), not the
   * API's raw `{error: "Invalid value"}` boilerplate. */
  error?: string;
  /** F-343: true specifically for a 409 "someone else already saved this"
   * conflict — distinct from every other failure, which is either a
   * validation error or a genuine outage. */
  stale?: boolean;
  /** F-343: the row's fresh `updatedAt` after this call — on success, so
   * the *next* save from this same editor isn't instantly "stale" against
   * its own last write; on a 409, so the editor could reload against the
   * value that won (this route doesn't echo the winning content itself,
   * only its timestamp, since only the caller knows this key's shape). */
  updatedAt?: string | null;
}

async function saveSetting(key: SettingKey, value: unknown, updatedAt?: Date | null): Promise<SaveSettingResult> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/settings/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // F-343: send back the `updatedAt` this editor last loaded/saved so a
      // save that's gone stale in the meantime (someone else saved this same
      // key first) is rejected with 409 instead of silently winning.
      body: JSON.stringify({ value, updatedAt: updatedAt ? updatedAt.toISOString() : undefined }),
    });
  } catch {
    // F-170: a network failure used to reject out of the editor's submit
    // handler, leaving the Save button stuck on "Saving…".
    return { ok: false, error: "Couldn't save — check your connection and try again." };
  }
  const body = await response.json().catch(() => ({}));
  if (response.ok) return { ok: true, updatedAt: body.updatedAt ?? null };
  if (response.status === 409) {
    return {
      ok: false,
      stale: true,
      error: formatApiError(body, "Changed by someone else — reload and try again.").summary,
    };
  }
  // F-02: these editors used to discard the response body entirely and
  // show a static, guessed message regardless of what the server actually
  // rejected — now the real per-field reason (e.g. a too-long announcement
  // line) reaches the admin.
  return { ok: false, error: formatApiError(body, "Couldn't save.").summary };
}

/** F-343: after a save call, advance a field's tracked `updatedAt` to the
 * server's fresh value on success, or leave it untouched on failure (a
 * failed write never changed the row, so the token that was already stale
 * — or already correct — stays exactly as good a guess as before). */
function nextUpdatedAt(prev: Date | null, result: SaveSettingResult): Date | null {
  return result.ok ? (result.updatedAt ? new Date(result.updatedAt) : null) : prev;
}

function SaveButton({ saving, saved }: { saving: boolean; saved: boolean }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? "Saving…" : saved ? "Saved" : "Save"}
    </button>
  );
}

export function AnnouncementEditor({
  initialMessages,
  updatedAt = null,
}: {
  initialMessages: string[];
  /** F-343: the "announcement.messages" row's `updatedAt` as loaded by the
   * server component that rendered this editor — see
   * getSettingUpdatedAt() in src/lib/settings. Optional so any test that
   * mounts this editor directly keeps working unchanged. */
  updatedAt?: Date | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages.join("\n"));
  // F-170: what's currently saved, to tell an untouched textarea from an
  // edited one — see useUnsavedChangesGuard below.
  const [baseline, setBaseline] = useState(messages);
  useUnsavedChangesGuard(isDirty(messages, baseline));
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    const value = messages
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const result = await saveSetting("announcement.messages", value, savedAt);
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      setSavedAt(result.updatedAt ? new Date(result.updatedAt) : null);
      // What was actually saved is the trimmed, blank-line-free list.
      const savedText = value.join("\n");
      setMessages(savedText);
      setBaseline(savedText);
      router.refresh();
    } else if (result.stale) {
      // F-343: someone else saved this key first — don't let this save
      // silently discard it. router.refresh() re-fetches the page's
      // server-rendered updatedAt/value for the *next* mount of this
      // editor; this instance's own draft text is left alone so nothing
      // the admin just typed is lost.
      setErrorMessage(result.error ?? "Changed by someone else — reload the page and try again.");
    } else {
      setErrorMessage(result.error ?? "Couldn't save — check no line is too long (200 characters max, 10 lines).");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-4">
      <label htmlFor="announcement-messages" className="block text-sm font-semibold text-ink">
        Announcement bar messages
      </label>
      <p id="announcement-messages-hint" className="mt-1 text-xs text-muted">
        One message per line, up to 10. Leave it empty to hide the announcement messages — the phone, WhatsApp and
        Bulk Order buttons stay in the top bar.
      </p>
      <textarea
        id="announcement-messages"
        aria-describedby="announcement-messages-hint"
        className="mt-3 w-full rounded-xl border border-border bg-surface-muted p-3 text-sm text-ink"
        rows={4}
        value={messages}
        onChange={(event) => {
          setMessages(event.target.value);
          setSaved(false);
        }}
      />
      <div className="mt-2">
        <FormErrorBanner message={errorMessage} />
      </div>
      <div className="mt-3">
        <SaveButton saving={saving} saved={saved} />
      </div>
    </form>
  );
}

type ContactSettingUpdatedAt = { phone: Date | null; whatsapp: Date | null; email: Date | null; address: Date | null };

export function ContactEditor({
  initial,
  updatedAt,
}: {
  initial: { phone: string; whatsapp: string; email: string; address: string };
  /** F-343: this form writes 4 independent SiteSetting rows — each needs
   * its own optimistic-concurrency token, since another admin could have
   * changed just one of them (e.g. only the phone number). */
  updatedAt?: ContactSettingUpdatedAt;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useUnsavedChangesGuard(isDirty(values, baseline));
  const [savedAt, setSavedAt] = useState<ContactSettingUpdatedAt>(
    updatedAt ?? { phone: null, whatsapp: null, email: null, address: null },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    const [phone, whatsapp, email, address] = await Promise.all([
      saveSetting("contact.phone", values.phone, savedAt.phone),
      saveSetting("contact.whatsapp", values.whatsapp, savedAt.whatsapp),
      saveSetting("contact.email", values.email, savedAt.email),
      saveSetting("contact.address", values.address, savedAt.address),
    ]);
    const results = { phone, whatsapp, email, address };
    setSaving(false);
    setSavedAt((prev) => ({
      phone: results.phone.ok ? (results.phone.updatedAt ? new Date(results.phone.updatedAt) : null) : prev.phone,
      whatsapp: results.whatsapp.ok
        ? results.whatsapp.updatedAt
          ? new Date(results.whatsapp.updatedAt)
          : null
        : prev.whatsapp,
      email: results.email.ok ? (results.email.updatedAt ? new Date(results.email.updatedAt) : null) : prev.email,
      address: results.address.ok
        ? results.address.updatedAt
          ? new Date(results.address.updatedAt)
          : null
        : prev.address,
    }));
    const failed = [phone, whatsapp, email, address].find((r) => !r.ok);
    if (!failed) {
      setSaved(true);
      setBaseline(values);
      router.refresh();
    } else if (failed.stale) {
      setErrorMessage(failed.error ?? "Changed by someone else — reload the page and try again.");
    } else {
      setErrorMessage(failed.error ?? "Couldn't save one or more fields — check the values.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink">Contact details</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Phone"
          value={values.phone}
          onChange={(v) => {
            setValues((s) => ({ ...s, phone: v }));
            setSaved(false);
          }}
        />
        <Field
          label="WhatsApp"
          value={values.whatsapp}
          onChange={(v) => {
            setValues((s) => ({ ...s, whatsapp: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Email"
          hint="Also the address new-order alerts are sent to."
          value={values.email}
          onChange={(v) => {
            setValues((s) => ({ ...s, email: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Address"
          value={values.address}
          onChange={(v) => {
            setValues((s) => ({ ...s, address: v }));
            setSaved(false);
          }}
        />
      </div>
      <div className="mt-2">
        <FormErrorBanner message={errorMessage} />
      </div>
      <div className="mt-3">
        <SaveButton saving={saving} saved={saved} />
      </div>
    </form>
  );
}

type LegalSettingUpdatedAt = {
  grievanceName: Date | null;
  grievanceDesignation: Date | null;
  grievancePhone: Date | null;
  grievanceEmail: Date | null;
  gstin: Date | null;
  stateCode: Date | null;
  returnsWindowDays: Date | null;
};

export function LegalComplianceEditor({
  initial,
  updatedAt,
}: {
  initial: {
    grievanceName: string;
    grievanceDesignation: string;
    grievancePhone: string;
    grievanceEmail: string;
    gstin: string;
    stateCode: string;
    returnsWindowDays: number;
  };
  /** F-343: 7 independent SiteSetting rows, each with its own token. */
  updatedAt?: LegalSettingUpdatedAt;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useUnsavedChangesGuard(isDirty(values, baseline));
  const [savedAt, setSavedAt] = useState<LegalSettingUpdatedAt>(
    updatedAt ?? {
      grievanceName: null,
      grievanceDesignation: null,
      grievancePhone: null,
      grievanceEmail: null,
      gstin: null,
      stateCode: null,
      returnsWindowDays: null,
    },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    const [grievanceName, grievanceDesignation, grievancePhone, grievanceEmail, gstin, stateCode, returnsWindowDays] =
      await Promise.all([
        saveSetting("grievance.name", values.grievanceName, savedAt.grievanceName),
        saveSetting("grievance.designation", values.grievanceDesignation, savedAt.grievanceDesignation),
        saveSetting("grievance.phone", values.grievancePhone, savedAt.grievancePhone),
        saveSetting("grievance.email", values.grievanceEmail, savedAt.grievanceEmail),
        saveSetting("legal.gstin", values.gstin, savedAt.gstin),
        saveSetting("legal.stateCode", values.stateCode, savedAt.stateCode),
        saveSetting("returns.windowDays", values.returnsWindowDays, savedAt.returnsWindowDays),
      ]);
    const results = { grievanceName, grievanceDesignation, grievancePhone, grievanceEmail, gstin, stateCode, returnsWindowDays };
    setSaving(false);
    setSavedAt((prev) => ({
      grievanceName: nextUpdatedAt(prev.grievanceName, results.grievanceName),
      grievanceDesignation: nextUpdatedAt(prev.grievanceDesignation, results.grievanceDesignation),
      grievancePhone: nextUpdatedAt(prev.grievancePhone, results.grievancePhone),
      grievanceEmail: nextUpdatedAt(prev.grievanceEmail, results.grievanceEmail),
      gstin: nextUpdatedAt(prev.gstin, results.gstin),
      stateCode: nextUpdatedAt(prev.stateCode, results.stateCode),
      returnsWindowDays: nextUpdatedAt(prev.returnsWindowDays, results.returnsWindowDays),
    }));
    const failed = Object.values(results).find((r) => !r.ok);
    if (!failed) {
      setSaved(true);
      setBaseline(values);
      router.refresh();
    } else if (failed.stale) {
      setErrorMessage(failed.error ?? "Changed by someone else — reload the page and try again.");
    } else {
      setErrorMessage(failed.error ?? "Couldn't save one or more fields — check the values.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink">Legal &amp; compliance</p>
      <p className="mt-1 text-xs text-muted">
        F-150/F-195/F-026: a named Grievance Officer, GST registration details, and the return
        window shown across /contact, the legal pages and the storefront. Every field below is
        blank by default and stays hidden on the site until you fill it in — nothing here is
        invented.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Grievance officer name"
          value={values.grievanceName}
          onChange={(v) => {
            setValues((s) => ({ ...s, grievanceName: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Grievance officer designation"
          value={values.grievanceDesignation}
          onChange={(v) => {
            setValues((s) => ({ ...s, grievanceDesignation: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Grievance officer phone"
          value={values.grievancePhone}
          onChange={(v) => {
            setValues((s) => ({ ...s, grievancePhone: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Grievance officer email"
          value={values.grievanceEmail}
          onChange={(v) => {
            setValues((s) => ({ ...s, grievanceEmail: v }));
            setSaved(false);
          }}
        />
        <Field
          label="GSTIN"
          value={values.gstin}
          onChange={(v) => {
            setValues((s) => ({ ...s, gstin: v }));
            setSaved(false);
          }}
        />
        <Field
          label="GST state code"
          value={values.stateCode}
          onChange={(v) => {
            setValues((s) => ({ ...s, stateCode: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Returns window (days)"
          type="number"
          value={String(values.returnsWindowDays)}
          onChange={(v) => {
            setValues((s) => ({ ...s, returnsWindowDays: Number(v) || 0 }));
            setSaved(false);
          }}
        />
      </div>
      <div className="mt-2">
        <FormErrorBanner message={errorMessage} />
      </div>
      <div className="mt-3">
        <SaveButton saving={saving} saved={saved} />
      </div>
    </form>
  );
}

type ShippingSettingUpdatedAt = { flatRate: Date | null; freeAbove: Date | null };

export function ShippingEditor({
  initial,
  updatedAt,
}: {
  initial: { flatRate: number; freeAbove: number };
  updatedAt?: ShippingSettingUpdatedAt;
}) {
  const router = useRouter();
  // F-165: keep what the admin typed as text. Coercing on every keystroke
  // (`Number(v) || 0`) turned a cleared field into a silent "0" — and a saved
  // 0 makes shipping free on every order. Parsed and checked on Save instead.
  const initialText = { flatRate: String(initial.flatRate), freeAbove: String(initial.freeAbove) };
  const [values, setValues] = useState(initialText);
  const [baseline, setBaseline] = useState(initialText);
  useUnsavedChangesGuard(isDirty(values, baseline));
  const [savedAt, setSavedAt] = useState<ShippingSettingUpdatedAt>(
    updatedAt ?? { flatRate: null, freeAbove: null },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    // Validate both amounts before sending either — they save as two
    // separate settings, so one must never go through while the other is
    // rejected.
    const checked = checkShippingInput(values);
    if (!checked.ok) {
      setErrorMessage(checked.error);
      return;
    }
    if (checked.confirmMessage && !window.confirm(checked.confirmMessage)) return;
    setSaving(true);
    const [flatRate, freeAbove] = await Promise.all([
      saveSetting("shipping.flatRate", checked.flatRate, savedAt.flatRate),
      saveSetting("shipping.freeAbove", checked.freeAbove, savedAt.freeAbove),
    ]);
    const results = { flatRate, freeAbove };
    setSaving(false);
    setSavedAt((prev) => ({
      flatRate: nextUpdatedAt(prev.flatRate, results.flatRate),
      freeAbove: nextUpdatedAt(prev.freeAbove, results.freeAbove),
    }));
    const failed = [flatRate, freeAbove].find((r) => !r.ok);
    if (!failed) {
      setSaved(true);
      setBaseline(values);
      router.refresh();
    } else if (failed.stale) {
      setErrorMessage(failed.error ?? "Changed by someone else — reload the page and try again.");
    } else {
      setErrorMessage(failed.error ?? "Couldn't save — values must be positive numbers.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink">Shipping</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Flat rate (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          value={values.flatRate}
          onChange={(v) => {
            setValues((s) => ({ ...s, flatRate: v }));
            setSaved(false);
          }}
        />
        <Field
          label="Free shipping above (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          value={values.freeAbove}
          onChange={(v) => {
            setValues((s) => ({ ...s, freeAbove: v }));
            setSaved(false);
          }}
        />
      </div>
      <div className="mt-2">
        <FormErrorBanner message={errorMessage} />
      </div>
      <div className="mt-3">
        <SaveButton saving={saving} saved={saved} />
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  inputMode,
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  inputMode?: "decimal" | "numeric";
  min?: number;
}) {
  return (
    <label className="block text-xs font-semibold text-muted">
      {label}
      <input
        type={type}
        inputMode={inputMode}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-border bg-surface-muted p-2.5 text-sm text-ink"
      />
      {hint ? <span className="mt-1 block text-[11px] font-normal text-muted">{hint}</span> : null}
    </label>
  );
}
