import { db } from "@/lib/db";

/**
 * F-049: neither a contact-form enquiry nor a bulk-order lead raised any
 * owner-facing alert at all. Bulk leads eventually got one — but only via
 * the seeded "Bulk Order Follow-up" journey's second step, which
 * `enrollInJourney` (src/lib/engagement/journey-engine.ts) schedules for
 * the next `/api/cron/journeys` run rather than running inline, and that
 * cron is scheduled once a day (`vercel.json`). Neither the journey
 * engine nor the cron schedule are files this package owns, so rather
 * than speeding up that path, this creates the alert immediately, from
 * the route that accepts the enquiry — the same `AdminNotification`
 * mechanism new orders, campaigns and Hermes approvals already use (see
 * src/lib/orders/notify.ts, src/lib/engagement/campaign-dispatcher.ts) to
 * reach the dashboard tile, the sidebar badge and the notifications page.
 * A bulk lead may still also get the journey's next-day notification —
 * a harmless duplicate — since the seed isn't ours to change either.
 *
 * Best-effort and silent on failure, matching every other
 * `adminNotification.create` call site in this codebase: a failed alert
 * must never turn an accepted enquiry into a 500 for the visitor who
 * submitted it.
 */
export interface NewEnquiryAlertInput {
  kind: "contact" | "bulk-order";
  id: string;
  name: string;
  organization?: string | null;
  /** First ~140 characters shown in the alert body; kept short deliberately. */
  messageSnippet?: string | null;
}

export async function notifyNewEnquiry(input: NewEnquiryAlertInput): Promise<void> {
  try {
    const title =
      input.kind === "contact"
        ? `New contact enquiry from ${input.name}`
        : `New bulk order enquiry from ${input.organization ?? input.name}`;

    const bodyParts = [input.organization && input.kind === "contact" ? input.organization : null, input.messageSnippet]
      .filter((part): part is string => Boolean(part && part.trim().length > 0))
      .map((part) => part.trim());

    await db.adminNotification.create({
      data: {
        title,
        body: bodyParts.length > 0 ? bodyParts.join(" — ").slice(0, 200) : "No message provided.",
        type: input.kind === "contact" ? "contact_enquiry" : "bulk_lead",
        metadata: JSON.stringify({ id: input.id, kind: input.kind }),
      },
    });
  } catch (error) {
    console.error("[admin/new-enquiry-alert] failed to create admin notification", error);
  }
}
