import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/**
 * DB-backed idempotency guard for cron jobs (engagement_compliance). Vercel
 * (or a manual `curl` retry) can fire the same scheduled function twice in
 * the same window; without a guard that means double-sending campaigns,
 * double-processing journey steps, etc. Creating a `CronRun` row is the
 * "claim" — the unique constraint on (job, runKey) means only the first
 * caller for a given window succeeds, and every later one gets a clean
 * "already ran" result instead of redoing the work.
 *
 * This is an ADDITIONAL guard alongside authorizeCron's bearer-token check,
 * not a replacement for it — authorizeCron still gates who may call the
 * route at all.
 */
export interface ClaimCronRunResult {
  /** True when this call created the CronRun row (i.e. it should proceed
   * with the job). False when a row for this (job, runKey) already existed
   * — or, on an unexpected DB error, when we deliberately failed open (see
   * below) so a bookkeeping hiccup can't wedge an actual cron job. */
  claimed: boolean;
}

export async function claimCronRun(job: string, runKey: string): Promise<ClaimCronRunResult> {
  try {
    await db.cronRun.create({ data: { job, runKey } });
    return { claimed: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Another invocation already claimed this (job, runKey) — the whole
      // point of the guard. Not an error.
      return { claimed: false };
    }

    // Anything else (DB unreachable, etc.) — fail OPEN. Skipping a cron
    // job's actual work because the idempotency bookkeeping table happened
    // to be unreachable would be a worse outcome than an occasional
    // (already rare) double-run; the underlying operations this guards
    // (campaign claim-then-send, journey enrollment locking, CampaignDelivery's
    // own unique constraint) each have their own idempotency protection too.
    console.warn(
      `[cron] CronRun claim failed for ${job}:${runKey}, proceeding without the idempotency guard:`,
      error instanceof Error ? error.message : error,
    );
    return { claimed: true };
  }
}

/**
 * F-277: gives a claim back. The CronRun row is written *before* the job
 * body runs (that is what makes a duplicate trigger harmless), so a job
 * that then throws — a transient DB error, a pool exhausted mid-run — used
 * to leave the claim behind: every later invocation for the same window
 * answered `alreadyRan`, the weekly report was lost for the week, and a
 * manual `vercel crons run` the same day did nothing. Best-effort: if the
 * release itself fails the original error still propagates, and the worst
 * case is the old behaviour (the window stays claimed).
 */
export async function releaseCronRun(job: string, runKey: string): Promise<void> {
  try {
    await db.cronRun.deleteMany({ where: { job, runKey } });
  } catch (error) {
    console.warn(
      `[cron] could not release the CronRun claim for ${job}:${runKey}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export type CronClaimOutcome<T> = { claimed: false } | { claimed: true; result: T };

/**
 * Claims (job, runKey), runs `run`, and releases the claim again if `run`
 * throws so the next invocation (or a manual re-run) does the work instead
 * of being told it already happened. The error is rethrown untouched — the
 * route still answers 500, which is what lets the platform's own retry and
 * the owner's alerting notice the failure.
 *
 * `runKey` is passed in (not recomputed) so a run that straddles a bucket
 * boundary releases the very row it created.
 *
 * A job that fails half-way may have done part of its work (a report
 * notification written before a later step threw); the retry then repeats
 * that part. Duplicating a notification is the cheaper failure than
 * silently skipping the whole day or week.
 */
export async function runWithCronClaim<T>(
  job: string,
  runKey: string,
  run: () => Promise<T>,
): Promise<CronClaimOutcome<T>> {
  const { claimed } = await claimCronRun(job, runKey);
  if (!claimed) return { claimed: false };
  try {
    return { claimed: true, result: await run() };
  } catch (error) {
    await releaseCronRun(job, runKey);
    throw error;
  }
}

/** UTC calendar date, e.g. "2026-09-18" — for jobs that run at most once a
 * day (journeys, campaigns, hermes, reports per vercel.json's schedules). */
export function dailyRunKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Bucketed run key for a job scheduled more than once a day, e.g. every 15
 * minutes (drain-email-outbox, per vercel.json). The ISO timestamp of the
 * start of the current `windowMinutes`-sized bucket is stable for every
 * call within that window and changes on the next one, so a duplicate
 * invocation within the same scheduled tick (a Vercel retry, a manual
 * re-curl) claims the same key and short-circuits via claimCronRun, the
 * same mechanism dailyRunKey uses for once-a-day jobs.
 */
export function intervalRunKey(windowMinutes: number, now: Date = new Date()): string {
  const bucketMs = windowMinutes * 60_000;
  const bucketStart = Math.floor(now.getTime() / bucketMs) * bucketMs;
  return new Date(bucketStart).toISOString();
}
