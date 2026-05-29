"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const taskTypes = [
  { id: "daily_seo_health_scan", label: "Daily SEO Health Scan" },
  { id: "weekly_competitor_scan", label: "Weekly Competitor Scan" },
  { id: "blog_opportunity", label: "Blog Opportunity Workflow" },
  { id: "campaign_draft", label: "Campaign Draft Workflow" },
];

export function HermesTaskLauncher() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const launch = async (type: string) => {
    setLoading(type);
    await fetch("/api/admin/hermes/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    router.refresh();
    setLoading(null);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {taskTypes.map((task) => (
        <button
          key={task.id}
          type="button"
          disabled={loading !== null}
          onClick={() => launch(task.id)}
          className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {loading === task.id ? "Running…" : task.label}
        </button>
      ))}
    </div>
  );
}
