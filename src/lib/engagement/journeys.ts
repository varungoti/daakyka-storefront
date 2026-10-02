import { Prisma, type CustomerJourney } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";

/**
 * Service layer for the admin journey status control — split out of
 * src/app/api/admin/journeys/[id]/route.ts (same convention as
 * src/lib/engagement/segments.ts and templates.ts) so the not-found rule
 * is testable without a request scope for requireAdminPermission().
 */

export type JourneyStatusValue = "DRAFT" | "ACTIVE" | "PAUSED";

export class JourneyNotFoundError extends Error {
  constructor(id: string) {
    super(`Journey ${id} not found`);
    this.name = "JourneyNotFoundError";
  }
}

/**
 * F-219: PATCH on an unknown or since-deleted journey id raised Prisma's
 * P2025 straight out of the route as an unhandled 500. It's a plain "no
 * such journey" — typed here so the route can answer 404.
 */
export async function updateJourneyStatus(
  id: string,
  status: JourneyStatusValue,
  actingUserId: string,
): Promise<CustomerJourney> {
  let journey: CustomerJourney;
  try {
    journey = await db.customerJourney.update({ where: { id }, data: { status } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new JourneyNotFoundError(id);
    }
    throw err;
  }

  await logAuditEvent({
    userId: actingUserId,
    action: "update_status",
    entity: "customer_journey",
    entityId: id,
    metadata: { status },
  });

  return journey;
}
