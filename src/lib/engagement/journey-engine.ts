import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { sendMarketingEmail } from "@/lib/engagement/send-marketing-email";
import { sendWhatsApp } from "@/lib/engagement/providers/whatsapp";
import { buildEngagementVars, renderTemplate, type TemplateVars } from "@/lib/engagement/template";

export interface JourneyContext extends TemplateVars {
  email?: string;
  phone?: string;
  firstName?: string;
  organization?: string;
  contactName?: string;
  shopUrl?: string;
}

type StepWithTemplate = {
  id: string;
  sortOrder: number;
  name: string;
  delayHours: number;
  channel: string;
  notes: string | null;
  template: { body: string; subject: string | null } | null;
};

// engagement_compliance: a claimed-but-never-released lock (a crashed
// process) shouldn't wedge an enrollment forever — after this long, treat
// the lock as stale and let the next cron run reclaim it.
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes
// Process due enrollments for up to this long per cron invocation, then
// stop and let the next scheduled run pick up the rest — replaces a single
// fixed-size `take: 50` batch, which (per the earlier audit note) could
// build an ever-growing backlog if more than 50 enrollments ever came due
// between runs.
const PROCESS_TIME_BUDGET_MS = 50_000;
const BATCH_SIZE = 50;

function scheduleAt(enrollmentCreatedAt: Date, delayHours: number): Date {
  return new Date(enrollmentCreatedAt.getTime() + delayHours * 60 * 60 * 1000);
}

async function executeStep(
  journeyId: string,
  step: StepWithTemplate,
  vars: JourneyContext,
  trigger: string,
): Promise<{ status: string; metadata: Record<string, unknown> }> {
  let status = "queued";
  let metadata: Record<string, unknown> = { step: step.name };

  if (step.channel === "ADMIN_NOTIFICATION") {
    await db.adminNotification.create({
      data: {
        title: `Journey step: ${step.name}`,
        body: step.notes ?? `Step fired for ${vars.organization ?? vars.email ?? "subscriber"}`,
        type: trigger,
        metadata: JSON.stringify(vars),
      },
    });
    status = "sent";
  } else if (step.channel === "EMAIL" && step.template && vars.email) {
    // engagement_compliance: HTML-escape substituted values in the HTML
    // body only — the plain-text part isn't HTML so it's rendered
    // unescaped — and route through sendMarketingEmail() instead of the
    // raw Brevo provider so unsubscribe enforcement + footer/headers apply
    // to journey emails the same way they do to campaign emails.
    const bodyHtml = renderTemplate(step.template.body, vars, { escapeHtml: true });
    const bodyText = renderTemplate(step.template.body, vars);
    const subject = step.template.subject
      ? renderTemplate(step.template.subject, vars)
      : step.name;
    const result = await sendMarketingEmail({
      to: vars.email,
      subject,
      html: `<p>${bodyHtml.replace(/\n/g, "<br/>")}</p>`,
      text: bodyText,
    });
    status = result.ok ? "sent" : result.provider === "skipped" ? "skipped" : "stub";
    metadata = { ...metadata, provider: result.provider, error: result.error };
  } else if (step.channel === "WHATSAPP" && step.template && vars.phone) {
    const message = renderTemplate(step.template.body, vars);
    const result = await sendWhatsApp({ phone: vars.phone, message });
    status = result.ok ? "sent" : "stub";
    metadata = { ...metadata, provider: result.provider, error: result.error };
  } else if (step.channel === "EMAIL" || step.channel === "WHATSAPP") {
    status = "stub";
    metadata = { ...metadata, reason: "Missing recipient or provider not configured" };
  }

  await db.journeyEvent.create({
    data: {
      journeyId,
      stepId: step.id,
      trigger,
      channel: step.channel,
      recipient: vars.email ?? vars.phone ?? null,
      status,
      metadata: JSON.stringify(metadata),
    },
  });

  return { status, metadata };
}

async function enrollInJourney(
  journey: {
    id: string;
    name: string;
    trigger: string;
    steps: StepWithTemplate[];
  },
  context: JourneyContext,
): Promise<string | null> {
  const vars = buildEngagementVars(context);
  const steps = [...journey.steps].sort((a, b) => a.sortOrder - b.sortOrder);
  if (steps.length === 0) return null;

  // engagement_compliance: application-level dedup for "no two
  // simultaneously ACTIVE enrollments in the same journey for the same
  // email" — the DB also enforces this with a partial unique index
  // (JourneyEnrollment_journeyId_email_active_key, see the
  // engagement_compliance migration and the comment on JourneyEnrollment in
  // schema.prisma), but checking here avoids a pointless
  // render-and-send-then-fail-on-insert for the common case, and this
  // check + the create below together makes a duplicate trigger (e.g. a
  // double-fired webhook, or newsletter confirm clicked twice) a no-op
  // instead of a second parallel journey.
  if (vars.email) {
    const existingActive = await db.journeyEnrollment.findFirst({
      where: { journeyId: journey.id, email: vars.email, status: "ACTIVE" },
      select: { id: true },
    });
    if (existingActive) return null;
  }

  const now = new Date();
  const firstStep = steps[0];
  let currentStep = 0;

  if (firstStep.delayHours === 0) {
    await executeStep(journey.id, firstStep, vars, journey.trigger);
    currentStep = 1;
  }

  const nextStep = steps[currentStep];

  try {
    const enrollment = await db.journeyEnrollment.create({
      data: {
        journeyId: journey.id,
        email: vars.email ?? null,
        phone: vars.phone ?? null,
        currentStep,
        context: JSON.stringify(vars),
        trigger: journey.trigger,
        nextRunAt: nextStep ? scheduleAt(now, nextStep.delayHours) : null,
        status: nextStep ? "ACTIVE" : "COMPLETED",
      },
    });
    return enrollment.id;
  } catch (error) {
    // Partial-unique-index race: another process enrolled this email in
    // this journey a moment earlier. The first step above may have already
    // sent/fired once more than ideal in that narrow window, but no
    // duplicate ACTIVE enrollment row is created.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

export async function triggerJourneys(
  trigger: string,
  context: JourneyContext,
): Promise<{ triggered: number; enrollments: string[] }> {
  const journeys = await db.customerJourney.findMany({
    where: { trigger, status: "ACTIVE" },
    include: {
      steps: { orderBy: { sortOrder: "asc" }, include: { template: true } },
    },
  });

  const enrollments: string[] = [];
  for (const journey of journeys) {
    const id = await enrollInJourney(journey, context);
    if (id) enrollments.push(id);
  }

  return { triggered: journeys.length, enrollments };
}

/** Atomically claims a due enrollment for processing by this run — sets
 * `lockedAt` only if it's currently unlocked or its lock is stale, so an
 * overlapping cron run can't process (and double-send) the same
 * enrollment. Exported for tests. */
async function claimEnrollment(enrollmentId: string, staleBefore: Date): Promise<boolean> {
  const result = await db.journeyEnrollment.updateMany({
    where: {
      id: enrollmentId,
      status: "ACTIVE",
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { lockedAt: new Date() },
  });
  return result.count === 1;
}

async function processOneEnrollment(enrollment: {
  id: string;
  journeyId: string;
  currentStep: number;
  trigger: string;
  context: string;
  createdAt: Date;
  journey: { steps: StepWithTemplate[] };
}): Promise<void> {
  const steps = enrollment.journey.steps;
  const step = steps[enrollment.currentStep];

  if (!step) {
    await db.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", nextRunAt: null, lockedAt: null },
    });
    return;
  }

  const vars = JSON.parse(enrollment.context) as JourneyContext;
  await executeStep(enrollment.journeyId, step, vars, enrollment.trigger);

  const nextIndex = enrollment.currentStep + 1;
  const nextStep = steps[nextIndex];

  await db.journeyEnrollment.update({
    where: { id: enrollment.id },
    data: {
      currentStep: nextIndex,
      nextRunAt: nextStep ? scheduleAt(enrollment.createdAt, nextStep.delayHours) : null,
      status: nextStep ? "ACTIVE" : "COMPLETED",
      lockedAt: null,
    },
  });
}

export async function processDueEnrollments(): Promise<{ processed: number }> {
  const start = Date.now();
  let processed = 0;

  // Loop in batches until nothing is due or the time budget runs out,
  // rather than a single `take: 50` pass — a busy day (or a run that fell
  // behind) can have more than one batch's worth of due steps, and the
  // previous fixed-size batch would leave the rest to build up
  // indefinitely since nothing else ever revisited them before the next
  // day's cron tick.
  while (Date.now() - start < PROCESS_TIME_BUDGET_MS) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LOCK_STALE_AFTER_MS);

    const due = await db.journeyEnrollment.findMany({
      where: {
        status: "ACTIVE",
        nextRunAt: { lte: now },
        // Only process journeys that are still ACTIVE (a journey paused or
        // taken back to DRAFT after enrollments already exist shouldn't
        // keep firing steps).
        journey: { status: "ACTIVE" },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      },
      include: {
        journey: {
          include: { steps: { orderBy: { sortOrder: "asc" }, include: { template: true } } },
        },
      },
      take: BATCH_SIZE,
    });

    if (due.length === 0) break;

    for (const enrollment of due) {
      if (Date.now() - start >= PROCESS_TIME_BUDGET_MS) break;

      const claimed = await claimEnrollment(enrollment.id, staleBefore);
      if (!claimed) continue; // another run claimed it first

      await processOneEnrollment(enrollment);
      processed += 1;
    }
  }

  return { processed };
}
