"use client";

import type { CampaignStatus } from "@/generated/prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const nextStatuses: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SCHEDULED", "SENT", "CANCELLED"],
  SCHEDULED: ["SENT", "CANCELLED"],
  // engagement_compliance: system-managed states (claimed by
  // campaign-dispatcher.ts while a send is in flight, or the terminal state
  // when every recipient attempt failed) — not something an admin picks
  // from this dropdown.
  SENDING: [],
  SENT: [],
  FAILED: ["SCHEDULED", "CANCELLED"],
  CANCELLED: ["DRAFT"],
};

interface CampaignPreview {
  ready: boolean;
  reason?: string;
  recipientCount?: number;
  channel?: string;
  segmentName?: string | null;
}

export function CampaignStatusSelect({
  campaignId,
  currentStatus,
}: {
  campaignId: string;
  currentStatus: CampaignStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const options = [currentStatus, ...nextStatuses[currentStatus]];

  const updateStatus = async (status: CampaignStatus, extra?: { scheduledAt?: string }) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // F-212: this used to be dropped on the floor, so a failed send
        // (missing template, already-sending, etc.) looked identical to a
        // successful one — the select just snapped back with no message.
        setMessage({ text: data?.error ?? "Couldn't update this campaign.", tone: "error" });
        return;
      }
      // F-212: report what dispatch actually did instead of leaving the
      // admin to guess. route.ts only attaches `dispatch` on the SENT path.
      const dispatch = data?.dispatch as
        | { sent: number; failed: number; stub: number; skipped: number; total: number }
        | undefined;
      if (dispatch) {
        setMessage({
          text: `Sent: ${dispatch.sent} delivered, ${dispatch.failed} failed, ${dispatch.stub} stub, ${dispatch.skipped} skipped (${dispatch.total} recipients).`,
          tone: dispatch.sent > 0 ? "info" : "error",
        });
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as CampaignStatus;

    if (next === "SCHEDULED") {
      // F-217: the route now *requires* a real, future scheduledAt before
      // it will accept SCHEDULED (a NULL one used to save fine and then
      // never send — processDueScheduledCampaigns only ever selects rows
      // where scheduledAt <= now). Collect it here rather than letting the
      // PATCH 400 with no way to supply one. window.prompt matches this
      // component's existing window.confirm for SENT — a full date/time
      // picker belongs on the campaign edit form (campaign-form.tsx) for
      // anyone who wants to set it ahead of time instead.
      const input = window.prompt(
        "Send this campaign at (local date & time, e.g. 2026-10-05 14:30):",
      );
      if (input === null) {
        event.target.value = currentStatus;
        return;
      }
      const parsedDate = new Date(input);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
        event.target.value = currentStatus;
        setMessage({
          text: "Enter a valid future date and time, e.g. 2026-10-05 14:30.",
          tone: "error",
        });
        return;
      }

      await updateStatus(next, { scheduledAt: parsedDate.toISOString() });
      return;
    }

    if (next === "SENT") {
      // F-212: sending is irreversible and reaches real customers, so this
      // is the one transition that needs a confirmation with a real
      // recipient count in front of it, not an instant dispatch on select.
      setMessage(null);
      let preview: CampaignPreview | null = null;
      try {
        const res = await fetch(`/api/admin/campaigns/${campaignId}/preview`);
        preview = await res.json();
      } catch {
        preview = null;
      }

      if (!preview || !preview.ready) {
        event.target.value = currentStatus;
        setMessage({ text: preview?.reason ?? "Couldn't check recipients for this campaign.", tone: "error" });
        return;
      }

      if (!preview.recipientCount) {
        event.target.value = currentStatus;
        setMessage({
          text: `"${preview.segmentName ?? "This segment"}" has no eligible recipients to send to.`,
          tone: "error",
        });
        return;
      }

      const confirmed = window.confirm(
        `Send this campaign now to ${preview.recipientCount} recipient${preview.recipientCount === 1 ? "" : "s"} via ${preview.channel}? This cannot be undone.`,
      );
      if (!confirmed) {
        event.target.value = currentStatus;
        return;
      }
    }

    await updateStatus(next);
  };

  return (
    <div>
      <select
        value={currentStatus}
        onChange={handleChange}
        disabled={pending}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((status) => (
          <option key={status} value={status}>
            {status.replace("_", " ")}
          </option>
        ))}
      </select>
      {message && (
        <p
          role="alert"
          className={`mt-1 max-w-xs text-xs ${message.tone === "error" ? "text-red-600" : "text-muted"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
