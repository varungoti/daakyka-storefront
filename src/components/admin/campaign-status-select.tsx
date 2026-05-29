"use client";

import type { CampaignStatus } from "@/generated/prisma/client";
import { useRouter } from "next/navigation";

const nextStatuses: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SCHEDULED", "SENT", "CANCELLED"],
  SCHEDULED: ["SENT", "CANCELLED"],
  SENT: [],
  CANCELLED: ["DRAFT"],
};

export function CampaignStatusSelect({
  campaignId,
  currentStatus,
}: {
  campaignId: string;
  currentStatus: CampaignStatus;
}) {
  const router = useRouter();
  const options = [currentStatus, ...nextStatuses[currentStatus]];

  const updateStatus = async (status: CampaignStatus) => {
    await fetch(`/api/admin/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  };

  return (
    <select
      value={currentStatus}
      onChange={(e) => updateStatus(e.target.value as CampaignStatus)}
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase outline-none focus:border-brand"
    >
      {options.map((status) => (
        <option key={status} value={status}>
          {status.replace("_", " ")}
        </option>
      ))}
    </select>
  );
}
