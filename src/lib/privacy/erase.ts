import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { reclaimMediaAssetIfUnused } from "@/lib/media/store";
import { ERASED_EMAIL, anonymiseOrdersById } from "@/lib/privacy/anonymise-orders";
import { emailMatches, notificationMatches, phoneMatches } from "@/lib/privacy/match";
import { resolveSubject, subjectReference, type PersonalDataSubject } from "@/lib/privacy/subject";

/**
 * F-315: "Erase personal data". One call removes one person from every table
 * that holds them — the Customer row (and with it addresses, tokens, reviews
 * and wishlist, which cascade), enquiries, bulk-order leads, newsletter and
 * WhatsApp opt-ins, back-in-stock signups, journey enrolments and events,
 * campaign deliveries, the email log, abandoned carts, legacy order events and
 * admin notifications that quote the address.
 *
 * Orders are NOT deleted. Their money, tax and invoice figures must be kept
 * for the GST retention period (counsel to confirm the floor — see
 * src/lib/privacy/retention.ts), so each order is *anonymised* instead: the
 * email becomes a fixed placeholder, the phone and free-text notes are
 * dropped, the address is cut down to state / pincode / country (the place of
 * supply GST needs), the guest-access link is revoked, and the link to the
 * Customer row is cut. Totals, items, tax and invoice numbers are untouched.
 *
 * An order still being fulfilled (not yet delivered, cancelled or refunded)
 * blocks the erasure — the courier and the payment reconciliation still need
 * the shopper's details — unless the caller overrides it.
 *
 * The audit row written afterwards holds only counts and a hashed reference,
 * never the person's address.
 */

/** Order states where fulfilment or payment reconciliation still needs the
 * shopper's contact details. */
const OPEN_ORDER_STATUSES = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED"] as const;

export class ErasureBlockedError extends Error {
  constructor(public readonly orderNumbers: string[]) {
    super(
      `Cannot erase yet: ${orderNumbers.length === 1 ? "order" : "orders"} ${orderNumbers.join(", ")} still being processed`,
    );
    this.name = "ErasureBlockedError";
  }
}

export interface ErasureOptions {
  /** The admin performing it — null/absent for a shopper's own request. */
  actorUserId?: string | null;
  source: "self-service" | "admin";
  /** Erase even though an order is still in flight (admin only). */
  includeOpenOrders?: boolean;
}

export interface ErasureReport {
  customerDeleted: boolean;
  /** Rows removed (or, for orders and redemptions, anonymised) per table. */
  counts: Record<string, number>;
  /** Hashed reference also stored on the audit row. */
  reference: string;
}

export async function erasePersonalData(input: PersonalDataSubject, options: ErasureOptions): Promise<ErasureReport> {
  const subject = await resolveSubject(input);
  const orderOwner = [...(subject.customerId ? [{ customerId: subject.customerId }] : []), ...emailMatches("email", subject)];

  const openOrders = await db.order.findMany({
    where: { status: { in: [...OPEN_ORDER_STATUSES] }, OR: orderOwner },
    select: { number: true },
    orderBy: { createdAt: "asc" },
  });
  if (openOrders.length > 0 && !options.includeOpenOrders) {
    throw new ErasureBlockedError(openOrders.map((order) => order.number));
  }

  // Photos a deleted account's reviews referenced — reclaimed after the rows
  // are gone (the attached-media guard would refuse before).
  const reviewPhotoIds = subject.customerId
    ? (await db.review.findMany({ where: { customerId: subject.customerId }, select: { photoIds: true } })).flatMap(
        (review) => review.photoIds,
      )
    : [];

  const counts: Record<string, number> = {};
  const customerDeleted = await db.$transaction(
    async (tx) => {
      const orderIds = (await tx.order.findMany({ where: { OR: orderOwner }, select: { id: true } })).map((order) => order.id);
      counts.ordersAnonymised = await anonymiseOrdersById(tx, orderIds);

      counts.discountRedemptionsAnonymised = (
        await tx.discountRedemption.updateMany({
          where: { OR: [...(subject.customerId ? [{ customerId: subject.customerId }] : []), ...emailMatches("email", subject)] },
          data: { email: ERASED_EMAIL, customerId: null },
        })
      ).count;

      const customer = subject.customerId ? await tx.customer.deleteMany({ where: { id: subject.customerId } }) : { count: 0 };
      counts.customers = customer.count;

      counts.contactEnquiries = (
        await tx.contactEnquiry.deleteMany({ where: { OR: [...emailMatches("email", subject), ...phoneMatches("phone", subject)] } })
      ).count;
      counts.bulkOrderLeads = (
        await tx.bulkOrderLead.deleteMany({ where: { OR: [...emailMatches("email", subject), ...phoneMatches("phone", subject)] } })
      ).count;
      counts.newsletterSubscribers = (
        await tx.newsletterSubscriber.deleteMany({ where: { OR: emailMatches("email", subject) } })
      ).count;
      counts.whatsappOptIns = (await tx.whatsAppOptIn.deleteMany({ where: { OR: phoneMatches("phone", subject) } })).count;
      counts.backInStockSubscriptions = (
        await tx.backInStockSubscription.deleteMany({ where: { OR: emailMatches("email", subject) } })
      ).count;
      counts.journeyEnrollments = (
        await tx.journeyEnrollment.deleteMany({ where: { OR: [...emailMatches("email", subject), ...phoneMatches("phone", subject)] } })
      ).count;
      counts.journeyEvents = (
        await tx.journeyEvent.deleteMany({ where: { OR: [...emailMatches("recipient", subject), ...phoneMatches("recipient", subject)] } })
      ).count;
      counts.campaignDeliveries = (
        await tx.campaignDelivery.deleteMany({ where: { OR: [...emailMatches("recipient", subject), ...phoneMatches("recipient", subject)] } })
      ).count;
      counts.emailOutbox = (await tx.emailOutbox.deleteMany({ where: { OR: emailMatches("to", subject) } })).count;
      counts.cartAbandonmentEvents = (
        await tx.cartAbandonmentEvent.deleteMany({ where: { OR: emailMatches("email", subject) } })
      ).count;
      counts.orderEvents = (
        await tx.orderEvent.deleteMany({ where: { OR: [...emailMatches("email", subject), ...phoneMatches("phone", subject)] } })
      ).count;
      counts.adminNotifications = (await tx.adminNotification.deleteMany({ where: { OR: notificationMatches(subject) } })).count;

      return customer.count > 0;
    },
    // Several dozen statements over indexed-or-small tables; the default 5s
    // interactive-transaction limit is too tight for a big account.
    { timeout: 30_000, maxWait: 10_000 },
  );

  for (const mediaId of new Set(reviewPhotoIds)) {
    try {
      await reclaimMediaAssetIfUnused(mediaId);
    } catch (error) {
      console.error("[privacy] could not reclaim an erased review photo", error instanceof Error ? error.message : error);
    }
  }

  const reference = subjectReference(subject);
  await logAuditEvent({
    userId: options.actorUserId ?? undefined,
    action: "erase",
    entity: subject.customerId ? "customer" : "personal_data",
    entityId: subject.customerId ?? reference,
    metadata: { source: options.source, reference, counts, includeOpenOrders: Boolean(options.includeOpenOrders) },
  }).catch((error) => {
    console.error("[privacy] erasure completed but its audit row could not be written", error instanceof Error ? error.message : error);
  });

  return { customerDeleted, counts, reference };
}
