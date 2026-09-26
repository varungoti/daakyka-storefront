"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignStatus } from "@/generated/prisma/client";

export interface CampaignFormInitial {
  id: string;
  name: string;
  channel: "EMAIL" | "WHATSAPP";
  status: CampaignStatus;
  segmentId: string | null;
  templateId: string | null;
  notes: string | null;
  /** ISO string, or null when never scheduled. */
  scheduledAt: string | null;
}

export interface CampaignFormOption {
  id: string;
  name: string;
}

export interface CampaignFormTemplateOption extends CampaignFormOption {
  channel: "EMAIL" | "WHATSAPP";
}

// F-217: mirrors campaigns/[id]/route.ts's EDITABLE_CAMPAIGN_STATUSES —
// a campaign's content can only change before it's committed to actually
// going out.
const EDITABLE_STATUSES: CampaignStatus[] = ["DRAFT", "PENDING_APPROVAL", "CANCELLED"];

/** `<input type="datetime-local">` wants "YYYY-MM-DDTHH:mm" in *local* time,
 * with no trailing "Z"/offset — this converts an ISO string (as stored/
 * returned by the API) to that shape for the initial value. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CampaignForm({
  initial,
  segments,
  templates,
}: {
  initial?: CampaignFormInitial;
  segments: CampaignFormOption[];
  templates: CampaignFormTemplateOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const editable = !initial || EDITABLE_STATUSES.includes(initial.status);

  const [name, setName] = useState(initial?.name ?? "");
  const [channel, setChannel] = useState<"EMAIL" | "WHATSAPP">(initial?.channel ?? "EMAIL");
  const [segmentId, setSegmentId] = useState(initial?.segmentId ?? "");
  const [templateId, setTemplateId] = useState(initial?.templateId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(initial?.scheduledAt ?? null));

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const templatesForChannel = useMemo(
    () => templates.filter((template) => template.channel === channel),
    [templates, channel],
  );

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);

    let scheduledAtIso: string | null = null;
    if (scheduledAt) {
      const parsedDate = new Date(scheduledAt);
      if (Number.isNaN(parsedDate.getTime())) {
        setStatus("error");
        setErrorMessage("Scheduled send time isn't a valid date.");
        return;
      }
      scheduledAtIso = parsedDate.toISOString();
    }

    const payload = isEdit
      ? {
          name: name.trim(),
          channel,
          segmentId: segmentId || null,
          templateId: templateId || null,
          notes: notes.trim() || null,
          scheduledAt: scheduledAtIso,
        }
      : {
          name: name.trim(),
          channel,
          status: "DRAFT" as const,
          segmentId: segmentId || null,
          templateId: templateId || null,
          notes: notes.trim() || undefined,
          scheduledAt: scheduledAtIso,
        };

    const response = await fetch(isEdit ? `/api/admin/campaigns/${initial!.id}` : "/api/admin/campaigns", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body?.error ?? "Couldn't save — check the fields above.");
      return;
    }

    router.push("/admin/campaigns");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      {!editable && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This campaign is {initial!.status.replace("_", " ").toLowerCase()}, so its details are locked. Cancel it
          from the Campaign Planner list to make changes.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
          />
        </Field>
        <Field label="Channel">
          <select
            value={channel}
            onChange={(e) => {
              const nextChannel = e.target.value as "EMAIL" | "WHATSAPP";
              setChannel(nextChannel);
              // A template picked for the old channel won't be a valid pick
              // for the new one — clear it rather than silently keep an
              // EMAIL template selected under a WHATSAPP campaign.
              if (!templates.some((t) => t.id === templateId && t.channel === nextChannel)) {
                setTemplateId("");
              }
            }}
            disabled={!editable}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
          >
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Audience segment" hint="Recipient counts are shown on the Segments page">
          <select
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
            disabled={!editable}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
          >
            <option value="">— No segment yet —</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Message template"
          hint={templatesForChannel.length === 0 ? `No ${channel === "EMAIL" ? "email" : "WhatsApp"} templates yet` : undefined}
        >
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={!editable}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
          >
            <option value="">— No template yet —</option>
            {templatesForChannel.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Scheduled send time (optional)"
        hint="Required before this campaign can be moved to Scheduled — set it here ahead of time, or you'll be asked for one when you pick Scheduled from the status dropdown."
      >
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          disabled={!editable}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
        />
      </Field>

      <Field label="Internal notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={!editable}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
        />
      </Field>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!editable || status === "saving" || !name.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create campaign"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/campaigns")}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}
