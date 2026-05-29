import { db } from "@/lib/db";
import { sendEmail } from "@/lib/engagement/providers/email";
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
    const body = renderTemplate(step.template.body, vars);
    const subject = step.template.subject
      ? renderTemplate(step.template.subject, vars)
      : step.name;
    const result = await sendEmail({
      to: vars.email,
      subject,
      html: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
      text: body,
    });
    status = result.ok ? "sent" : "stub";
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

  const now = new Date();
  const firstStep = steps[0];
  let currentStep = 0;

  if (firstStep.delayHours === 0) {
    await executeStep(journey.id, firstStep, vars, journey.trigger);
    currentStep = 1;
  }

  const nextStep = steps[currentStep];
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

export async function processDueEnrollments(): Promise<{ processed: number }> {
  const now = new Date();
  const due = await db.journeyEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    include: {
      journey: {
        include: { steps: { orderBy: { sortOrder: "asc" }, include: { template: true } } },
      },
    },
    take: 50,
  });

  for (const enrollment of due) {
    const steps = enrollment.journey.steps;
    const step = steps[enrollment.currentStep];
    if (!step) {
      await db.journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED", nextRunAt: null },
      });
      continue;
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
      },
    });
  }

  return { processed: due.length };
}
