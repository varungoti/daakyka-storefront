import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { dailyRunKey, runWithCronClaim } from "@/lib/cron/idempotency";
import { db } from "@/lib/db";
import {
  buildWeeklyGrowthReport,
  formatWeeklyGrowthReportMarkdown,
} from "@/lib/reports/weekly-growth";
import { dispatchHermesTask } from "@/lib/hermes/client";

async function buildAndQueueWeeklyReport() {
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

  // F-276: this approval's payload is the report/markdown this route just
  // built locally, not Hermes's own output — that's real content either
  // way, so it shouldn't depend on whether the Hermes call succeeded. It
  // used to gate on `hermes.ok`, which is also true for every "Hermes not
  // configured" stub response, so this was never actually skipped in
  // practice — but gating on it made a genuine Hermes failure (ok:false)
  // silently drop a report the owner should still see.
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

  return report;
}

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Runs once/week per vercel.json ("0 7 * * 1") — a calendar-date runKey
  // still guards correctly here since the schedule only ever fires it once
  // within any given date.
  //
  // F-277: runWithCronClaim gives the claim back if the report throws —
  // otherwise one transient DB error lost the whole week's report (a
  // same-day manual re-run answered "alreadyRan").
  const outcome = await runWithCronClaim("reports", dailyRunKey(), buildAndQueueWeeklyReport);
  if (!outcome.claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true });
  }

  return NextResponse.json({ ok: true, report: outcome.result });
}

export async function GET(request: Request) {
  return POST(request);
}
