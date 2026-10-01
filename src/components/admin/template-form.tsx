"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { buildEngagementVars, renderTemplate } from "@/lib/engagement/template";
import { formatApiError } from "@/lib/validation/format-api-error";

export interface TemplateFormInitial {
  id: string;
  name: string;
  channel: "EMAIL" | "WHATSAPP";
  subject: string | null;
  body: string;
  variables: string | null;
}

const SAMPLE_VARS = buildEngagementVars({
  email: "priya@example.com",
  contact_name: "Priya Sharma",
  organization: "City General Hospital",
});

export function TemplateForm({ initial }: { initial?: TemplateFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [channel, setChannel] = useState<"EMAIL" | "WHATSAPP">(initial?.channel ?? "EMAIL");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const renderedSubject = useMemo(
    () => (subject.trim() ? renderTemplate(subject, SAMPLE_VARS) : ""),
    [subject],
  );
  const renderedBody = useMemo(() => renderTemplate(body, SAMPLE_VARS), [body]);

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});

    const payload = {
      name: name.trim(),
      channel,
      subject: subject.trim() || null,
      body,
    };

    try {
      const response = await fetch(isEdit ? `/api/admin/templates/${initial!.id}` : "/api/admin/templates", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // F-219: responseBody.error is always the generic "Validation
        // failed" — the real reason (and which field) lives in `issues`.
        const responseBody = await response.json().catch(() => ({}));
        const { summary, fieldErrors: fe } = formatApiError(responseBody, "Couldn't save — check the fields above.");
        setStatus("error");
        setErrorMessage(summary);
        setFieldErrors(fe);
        return;
      }
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't save — check your connection and try again.");
      return;
    }

    router.push("/admin/templates");
    router.refresh();
  };

  const sendTest = async () => {
    if (!isEdit) return;
    setTestStatus("sending");
    setTestMessage(null);
    // F-217: send the form's current subject/body, not just whatever was
    // last saved — otherwise "Send test" while mid-edit silently tests the
    // old copy instead of what's on screen.
    const response = await fetch(`/api/admin/templates/${initial!.id}/send-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: channel === "EMAIL" ? subject.trim() || undefined : undefined,
        body,
      }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (response.ok && responseBody?.ok) {
      setTestStatus("sent");
      setTestMessage(`Sent to ${responseBody.sentTo}`);
    } else {
      setTestStatus("failed");
      setTestMessage(responseBody?.error ?? "Couldn't send test — is an email provider configured?");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6 rounded-2xl border border-border bg-surface p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fieldErrors.name}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
            />
          </Field>
          <Field label="Channel">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as "EMAIL" | "WHATSAPP")}
              className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
            >
              <option value="EMAIL">Email</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
          </Field>
        </div>

        {channel === "EMAIL" && (
          <Field label="Subject" error={fieldErrors.subject}>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-invalid={Boolean(fieldErrors.subject)}
              className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
            />
          </Field>
        )}

        <Field
          label="Body"
          hint="Use {{first_name}}, {{contact_name}}, {{organization}}, {{shop_url}}"
          error={fieldErrors.body}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            aria-invalid={Boolean(fieldErrors.body)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>

        <FormErrorBanner message={errorMessage} />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={status === "saving" || !name.trim() || body.trim().length < 10}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create template"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/templates")}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
          >
            Cancel
          </button>
          {isEdit && (
            <button
              type="button"
              onClick={sendTest}
              disabled={testStatus === "sending"}
              className="rounded-full border border-brand px-5 py-2.5 text-sm font-semibold text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testStatus === "sending" ? "Sending…" : "Send test to my email"}
            </button>
          )}
        </div>
        {testMessage && (
          <p className={`text-sm ${testStatus === "sent" ? "text-trust" : "text-amber-700"}`}>{testMessage}</p>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-dashed border-border bg-lavender/20 p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Live Preview (sample data)</p>
        {channel === "EMAIL" && renderedSubject && (
          <p className="text-sm font-semibold text-ink">Subject: {renderedSubject}</p>
        )}
        <div className="whitespace-pre-wrap rounded-xl bg-surface p-4 text-sm text-ink shadow-sm">
          {renderedBody || <span className="text-muted">Nothing to preview yet.</span>}
        </div>
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
        <span className="mt-1 block text-[11px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
