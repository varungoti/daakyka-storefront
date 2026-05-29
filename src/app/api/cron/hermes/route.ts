import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { db } from "@/lib/db";
import { dispatchHermesTask } from "@/lib/hermes/client";

const scheduledTasks = ["daily_seo_health_scan", "weekly_competitor_scan"] as const;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = [];
  for (const type of scheduledTasks) {
    const task = await db.hermesTask.create({ data: { type, status: "RUNNING" } });
    const result = await dispatchHermesTask({ type });
    await db.hermesTask.update({
      where: { id: task.id },
      data: {
        status: result.ok ? "COMPLETED" : "FAILED",
        output: result.output ?? result.error ?? null,
        completedAt: new Date(),
      },
    });
    if (result.ok && result.output) {
      await db.hermesApproval.create({
        data: {
          taskId: task.id,
          type,
          title: `Scheduled: ${type.replace(/_/g, " ")}`,
          summary: "Automated cron run — review before acting.",
          payload: result.output,
          status: "PENDING",
        },
      });
    }
    results.push({ type, ok: result.ok });
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET(request: Request) {
  return POST(request);
}
