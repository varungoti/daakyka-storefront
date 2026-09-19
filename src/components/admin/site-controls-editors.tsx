"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SettingKey } from "@/lib/settings";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { formatApiError } from "@/lib/validation/format-api-error";

interface SaveSettingResult {
  ok: boolean;
  /** Populated on failure — the mapped, human-readable message from
   * formatApiError() (see src/lib/validation/format-api-error.ts), not the
   * API's raw `{error: "Invalid value"}` boilerplate. */
  error?: string;
}

async function saveSetting(key: SettingKey, value: unknown): Promise<SaveSettingResult> {
  const response = await fetch(`/api/admin/settings/${key}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (response.ok) return { ok: true };
  // F-02: these editors used to discard the response body entirely and
  // show a static, guessed message regardless of what the server actually
  // rejected — now the real per-field reason (e.g. a too-long announcement
  // line) reaches the admin.
  const body = await response.json().catch(() => ({}));
  return { ok: false, error: formatApiError(body, "Couldn't save.").summary };
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

export function AnnouncementEditor({ initialMessages }: { initialMessages: string[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages.join("\n"));
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
    const result = await saveSetting("announcement.messages", value);
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setErrorMessage(result.error ?? "Couldn't save — check each line isn't empty or too long.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink">Announcement bar messages</p>
      <p className="mt-1 text-xs text-muted">One message per line.</p>
      <textarea
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

export function ContactEditor({
  initial,
}: {
  initial: { phone: string; whatsapp: string; email: string; address: string };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    const results = await Promise.all([
      saveSetting("contact.phone", values.phone),
      saveSetting("contact.whatsapp", values.whatsapp),
      saveSetting("contact.email", values.email),
      saveSetting("contact.address", values.address),
    ]);
    setSaving(false);
    const failed = results.find((r) => !r.ok);
    if (!failed) {
      setSaved(true);
      router.refresh();
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

export function ShippingEditor({
  initial,
}: {
  initial: { flatRate: number; freeAbove: number };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    const results = await Promise.all([
      saveSetting("shipping.flatRate", values.flatRate),
      saveSetting("shipping.freeAbove", values.freeAbove),
    ]);
    setSaving(false);
    const failed = results.find((r) => !r.ok);
    if (!failed) {
      setSaved(true);
      router.refresh();
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
          value={String(values.flatRate)}
          onChange={(v) => {
            setValues((s) => ({ ...s, flatRate: Number(v) || 0 }));
            setSaved(false);
          }}
        />
        <Field
          label="Free shipping above (₹)"
          type="number"
          value={String(values.freeAbove)}
          onChange={(v) => {
            setValues((s) => ({ ...s, freeAbove: Number(v) || 0 }));
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs font-semibold text-muted">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-border bg-surface-muted p-2.5 text-sm text-ink"
      />
    </label>
  );
}
