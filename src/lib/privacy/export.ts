import { db } from "@/lib/db";
import { emailMatches, notificationMatches, outboxBodyMentions, phoneMatches } from "@/lib/privacy/match";
import { resolveSubject, type PersonalDataSubject, type ResolvedSubject } from "@/lib/privacy/subject";

/**
 * F-315: "Export customer data" — everything held about one person, as one
 * JSON document, across the same tables erase.ts removes from. Used by the
 * shopper's own "Download my data" (audience "customer") and the admin's
 * per-customer / per-email export (audience "admin").
 *
 * Which rows count as the person's depends on who asks (SubjectTrust in
 * subject.ts): the owner's export matches every email and phone on the
 * account; the shopper's own copy only what their session proves — the
 * account's rows, plus rows keyed to its email once that email is verified.
 * The `limitations` list says so in the file itself, so a shopper is not left
 * thinking a shorter export is a complete one.
 *
 * What is deliberately NOT included: password hashes, session and token
 * material, the rendered bodies of emails (they hold live links — see
 * src/lib/engagement/outbox-seal.ts) and, for the shopper's own copy, the
 * staff's internal order notes.
 */

export type ExportAudience = "customer" | "admin";

export interface PersonalDataExport {
  generatedAt: string;
  /** Plain-language notes on what this copy does not cover (empty for the owner's). */
  limitations: string[];
  subject: { customerId: string | null; emails: string[]; phones: string[] };
  account: unknown;
  addresses: unknown[];
  orders: unknown[];
  reviews: unknown[];
  wishlist: unknown[];
  newsletter: unknown[];
  whatsappOptIns: unknown[];
  contactEnquiries: unknown[];
  bulkOrderLeads: unknown[];
  backInStockSignups: unknown[];
  discountRedemptions: unknown[];
  journeyEnrollments: unknown[];
  journeyMessages: unknown[];
  campaignMessages: unknown[];
  emailLog: unknown[];
  /** Admin only: emails addressed to someone else (the store's own new-order alert) that quote this person. */
  emailMentions: unknown[];
  abandonedCarts: unknown[];
  legacyOrderEvents: unknown[];
  adminNotifications: unknown[];
}

export async function exportPersonalData(
  input: PersonalDataSubject,
  options: { audience: ExportAudience },
): Promise<PersonalDataExport> {
  const subject = await resolveSubject(input, { trust: options.audience === "customer" ? "self-service" : "admin" });
  return collectPersonalData(subject, options.audience);
}

async function collectPersonalData(subject: ResolvedSubject, audience: ExportAudience): Promise<PersonalDataExport> {
  const { customerId } = subject;
  const emailOrPhone = (emailField: string, phoneField?: string) => [
    ...emailMatches(emailField, subject),
    ...(phoneField ? phoneMatches(phoneField, subject) : []),
  ];

  const [
    account,
    addresses,
    orders,
    reviews,
    wishlist,
    newsletter,
    whatsappOptIns,
    contactEnquiries,
    bulkOrderLeads,
    backInStockSignups,
    discountRedemptions,
    journeyEnrollments,
    journeyMessages,
    campaignMessages,
    emailLog,
    emailMentions,
    abandonedCarts,
    legacyOrderEvents,
    adminNotifications,
  ] = await Promise.all([
    customerId
      ? db.customer.findUnique({
          where: { id: customerId },
          select: { id: true, email: true, name: true, phone: true, emailVerifiedAt: true, active: true, createdAt: true },
        })
      : null,
    customerId ? db.customerAddress.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }) : [],
    db.order.findMany({
      where: { OR: [...(customerId ? [{ customerId }] : []), ...emailMatches("email", subject)] },
      orderBy: { createdAt: "asc" },
      select: {
        number: true,
        status: true,
        paymentMethod: true,
        createdAt: true,
        paidAt: true,
        shippedAt: true,
        deliveredAt: true,
        cancelledAt: true,
        email: true,
        phone: true,
        shippingAddress: true,
        currency: true,
        subtotal: true,
        shipping: true,
        discount: true,
        discountCode: true,
        total: true,
        invoiceNumber: true,
        trackingNumber: true,
        courier: true,
        notes: true,
        ...(audience === "admin" ? { adminNotes: true } : {}),
        items: { select: { productName: true, variantLabel: true, sku: true, quantity: true, unitPrice: true } },
      },
    }),
    customerId
      ? db.review.findMany({
          where: { customerId },
          orderBy: { createdAt: "asc" },
          select: {
            rating: true,
            title: true,
            body: true,
            status: true,
            verifiedPurchase: true,
            createdAt: true,
            product: { select: { name: true } },
          },
        })
      : [],
    customerId
      ? db.wishlistItem.findMany({
          where: { customerId },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true, product: { select: { name: true } } },
        })
      : [],
    db.newsletterSubscriber.findMany({
      where: { OR: emailMatches("email", subject) },
      select: { email: true, source: true, consentGiven: true, confirmedAt: true, unsubscribedAt: true, createdAt: true },
    }),
    db.whatsAppOptIn.findMany({ where: { OR: phoneMatches("phone", subject) } }),
    db.contactEnquiry.findMany({ where: { OR: emailOrPhone("email", "phone") }, orderBy: { createdAt: "asc" } }),
    db.bulkOrderLead.findMany({ where: { OR: emailOrPhone("email", "phone") }, orderBy: { createdAt: "asc" } }),
    db.backInStockSubscription.findMany({
      where: { OR: emailMatches("email", subject) },
      select: { createdAt: true, notifiedAt: true, product: { select: { name: true } }, variant: { select: { size: true, color: true } } },
    }),
    db.discountRedemption.findMany({
      where: { OR: [...(customerId ? [{ customerId }] : []), ...emailMatches("email", subject)] },
      select: { createdAt: true, discount: { select: { code: true } } },
    }),
    db.journeyEnrollment.findMany({
      where: { OR: emailOrPhone("email", "phone") },
      select: {
        email: true,
        phone: true,
        status: true,
        trigger: true,
        context: true,
        createdAt: true,
        journey: { select: { name: true } },
      },
    }),
    db.journeyEvent.findMany({
      where: { OR: [...emailMatches("recipient", subject), ...phoneMatches("recipient", subject)] },
      select: { trigger: true, channel: true, status: true, recipient: true, createdAt: true },
    }),
    db.campaignDelivery.findMany({
      where: { OR: [...emailMatches("recipient", subject), ...phoneMatches("recipient", subject)] },
      select: { channel: true, status: true, recipient: true, sentAt: true, campaign: { select: { name: true } } },
    }),
    db.emailOutbox.findMany({
      where: { OR: emailMatches("to", subject) },
      orderBy: { createdAt: "asc" },
      select: { to: true, kind: true, subject: true, status: true, createdAt: true, sentAt: true },
    }),
    audience === "admin" && outboxBodyMentions(subject).length > 0
      ? db.emailOutbox.findMany({
          where: {
            OR: outboxBodyMentions(subject),
            ...(subject.emails.length > 0 ? { NOT: { OR: emailMatches("to", subject) } } : {}),
          },
          orderBy: { createdAt: "asc" },
          select: { to: true, kind: true, subject: true, status: true, createdAt: true },
        })
      : [],
    db.cartAbandonmentEvent.findMany({
      where: { OR: emailMatches("email", subject) },
      select: { email: true, itemCount: true, subtotal: true, recovered: true, createdAt: true },
    }),
    db.orderEvent.findMany({
      where: { OR: emailOrPhone("email", "phone") },
      select: { email: true, phone: true, total: true, status: true, source: true, createdAt: true },
    }),
    audience === "admin"
      ? db.adminNotification.findMany({
          where: { OR: notificationMatches(subject) },
          orderBy: { createdAt: "asc" },
          select: { title: true, body: true, type: true, createdAt: true },
        })
      : [],
  ]);

  return {
    generatedAt: new Date().toISOString(),
    limitations: exportLimitations(subject),
    subject: { customerId, emails: subject.emails, phones: subject.phones },
    account,
    addresses,
    orders,
    reviews,
    wishlist,
    newsletter,
    whatsappOptIns,
    contactEnquiries,
    bulkOrderLeads,
    backInStockSignups,
    discountRedemptions,
    journeyEnrollments,
    journeyMessages,
    campaignMessages,
    emailLog,
    emailMentions,
    abandonedCarts,
    legacyOrderEvents,
    adminNotifications,
  };
}

function exportLimitations(subject: ResolvedSubject): string[] {
  if (subject.trust !== "self-service") return [];
  const notes: string[] = [];
  if (!subject.emailVerified) {
    notes.push(
      "Your email address is not verified yet, so this copy only covers records attached to your account. Verify your email to also include guest orders, enquiries, newsletter and other records made with that address.",
    );
  }
  notes.push(
    "Records we hold only against a phone number (for example a WhatsApp opt-in) are not linked to your account because the number is not verified. Contact us and we will look them up for you.",
  );
  return notes;
}
