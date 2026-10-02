import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { dailyRunKey, runWithCronClaim } from "@/lib/cron/idempotency";
import { db } from "@/lib/db";
import { dispatchHermesTask } from "@/lib/hermes/client";

const scheduledTasks = ["daily_seo_health_scan", "weekly_competitor_scan"] as const;

/** F-276: weekly_competitor_scan only needs to run once a week — Monday
 * (UTC) matches this cron's Monday-anchored sibling (reports, schedule
 * "0 7 * * 1") and keeps the check trivial to reason about. Exported (and
 * taking `now` as a parameter) so a test can assert the Monday/non-Monday
 * behavior without depending on the day the test suite happens to run. */
export function isWeeklyScanDue(now: Date = new Date()): boolean {
  return now.getUTCDay() === 1;
}

async function runScheduledHermesTasks() {
  const results = [];
  for (const type of scheduledTasks) {
    // F-276: this route runs daily, but weekly_competitor_scan is meant to
    // run weekly — skip it outright on every day but Monday rather than
    // creating a task/approval for it 7x too often.
    if (type === "weekly_competitor_scan" && !isWeeklyScanDue()) {
      continue;
    }

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
    // F-276: every "Hermes not configured" branch in dispatchHermesTask
    // returns ok:true with a canned placeholder payload (stub:true) so the
    // task itself still records something to look at. Only a non-stub
    // result is an actual recommendation worth putting in front of an
    // admin — creating a PENDING approval for the placeholder too meant
    // this queue filled up with generic "Scheduled: …" rows every single
    // day, pushing real approvals off the (unpaginated) 20-item list.
    if (result.ok && result.output && !result.stub) {
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
    results.push({ type, ok: result.ok, stub: result.stub === true });
  }

  return results;
}

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Runs once/day per vercel.json ("0 6 * * *"). F-277: runWithCronClaim
  // gives the claim back if a scan throws, so a manual re-run the same day
  // isn't told "alreadyRan".
  const outcome = await runWithCronClaim("hermes", dailyRunKey(), runScheduledHermesTasks);
  if (!outcome.claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true, results: [] });
  }

  return NextResponse.json({ ok: true, results: outcome.result });
}

export async function GET(request: Request) {
  return POST(request);
}
