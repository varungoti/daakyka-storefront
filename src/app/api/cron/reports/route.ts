import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { claimCronRun, dailyRunKey } from "@/lib/cron/idempotency";
import { db } from "@/lib/db";
import {
  buildWeeklyGrowthReport,
  formatWeeklyGrowthReportMarkdown,
} from "@/lib/reports/weekly-growth";
import { dispatchHermesTask } from "@/lib/hermes/client";

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Runs once/week per vercel.json ("0 7 * * 1") — a calendar-date runKey
  // still guards correctly here since the schedule only ever fires it once
  // within any given date.
  const { claimed } = await claimCronRun("reports", dailyRunKey());
  if (!claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true });
  }

  const report = await buildWeeklyGrowthReport(7);
  const markdown = formatWeeklyGrowthReportMarkdown(report);

  await db.adminNotification.create({
    data: {
      type: "WEEKLY_GROWTH_REPORT",
      title: `Weekly Growth Report — ${new Date().toLocaleDateString("en-IN")}`,
      body: report.recommendations.join(" "),
      metadata: JSON.stringify({ report, markdown }),
    },
  });

  const task = await db.hermesTask.create({
    data: { type: "weekly_growth_report", status: "RUNNING" },
  });

  const hermes = await dispatchHermesTask({
    type: "weekly_growth_report",
    input: { report },
  });

  await db.hermesTask.update({
    where: { id: task.id },
    data: {
      status: hermes.ok ? "COMPLETED" : "FAILED",
      output: hermes.output ?? hermes.error ?? markdown,
      completedAt: new Date(),
    },
  });

  if (hermes.ok) {
    await db.hermesApproval.create({
      data: {
        taskId: task.id,
        type: "weekly_growth_report",
        title: "Weekly Growth Report",
        summary: "Review metrics and recommended actions before acting on campaigns or SEO changes.",
        payload: JSON.stringify({ markdown, report }),
        status: "PENDING",
      },
    });
  }

  return NextResponse.json({ ok: true, report });
}

export async function GET(request: Request) {
  return POST(request);
}
