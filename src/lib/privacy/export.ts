import { db } from "@/lib/db";
import { emailMatches, notificationMatches, phoneMatches } from "@/lib/privacy/match";
import { resolveSubject, type PersonalDataSubject, type ResolvedSubject } from "@/lib/privacy/subject";

/**
 * F-315: "Export customer data" — everything held about one person, as one
 * JSON document, across the same tables erase.ts removes from. Used by the
 * shopper's own "Download my data" (audience "customer") and the admin's
 * per-customer / per-email export (audience "admin").
 *
 * What is deliberately NOT included: password hashes, session and token
 * material, the rendered bodies of emails (they hold live links — see
 * src/lib/engagement/outbox-seal.ts) and, for the shopper's own copy, the
 * staff's internal order notes.
 */

export type ExportAudience = "customer" | "admin";

export interface PersonalDataExport {
  generatedAt: string;
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
  abandonedCarts: unknown[];
  legacyOrderEvents: unknown[];
  adminNotifications: unknown[];
}

export async function exportPersonalData(
  input: PersonalDataSubject,
  options: { audience: ExportAudience },
): Promise<PersonalDataExport> {
  const subject = await resolveSubject(input);
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
    abandonedCarts,
    legacyOrderEvents,
    adminNotifications,
  };
}
