import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { authorizeCron } from "@/lib/cron/authorize";
import { dailyRunKey, runWithCronClaim } from "@/lib/cron/idempotency";
import { runRetention } from "@/lib/privacy/retention";

/**
 * F-316: enforces the data-retention schedule (src/lib/privacy/retention.ts)
 * — deletes or anonymises personal data that has outlived its purpose, in
 * bounded batches. Runs once a day per vercel.json ("30 3 * * *", an off-peak
 * hour in India), well inside the function's time budget; anything left when
 * the budget runs out is picked up by the next day's run.
 *
 * Idempotent two ways: runWithCronClaim makes a duplicate trigger for the
 * same day a no-op (and releases the claim if the run throws, so a retry
 * works), and every rule only matches rows it has not already handled.
 */
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcome = await runWithCronClaim("retention", dailyRunKey(), runRetention);
  if (!outcome.claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true });
  }

  const result = outcome.result;
  for (const failed of result.rules.filter((rule) => rule.error)) {
    console.error(`[cron/retention] rule ${failed.id} failed: ${failed.error}`);
  }
  if (result.totalHandled > 0) {
    // Counts only — never the data. Best-effort: a failed audit write must not
    // turn a completed purge into a 500 (the claim is already kept).
    await logAuditEvent({
      action: "retention",
      entity: "retention",
      metadata: {
        totalHandled: result.totalHandled,
        elapsedMs: result.elapsedMs,
        rules: Object.fromEntries(result.rules.filter((rule) => rule.handled > 0).map((rule) => [rule.id, rule.handled])),
        ...(result.rules.some((rule) => rule.more) ? { unfinished: result.rules.filter((rule) => rule.more).map((rule) => rule.id) } : {}),
      },
    }).catch((error) => {
      console.error("[cron/retention] could not write the audit row", error instanceof Error ? error.message : error);
    });
  }

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
