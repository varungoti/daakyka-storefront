import { db } from "@/lib/db";

export interface SegmentRecipient {
  email?: string;
  phone?: string;
  firstName?: string;
  contactName?: string;
  organization?: string;
}

interface SegmentCriteria {
  source?: string;
  consent?: boolean;
  leadType?: string;
  pages?: string[];
}

function parseCriteria(raw: string): SegmentCriteria {
  try {
    return JSON.parse(raw) as SegmentCriteria;
  } catch {
    return {};
  }
}

function dedupeRecipients(recipients: SegmentRecipient[]): SegmentRecipient[] {
  const seen = new Set<string>();
  const result: SegmentRecipient[] = [];

  for (const recipient of recipients) {
    const key = recipient.email ?? recipient.phone;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(recipient);
  }

  return result;
}

export async function resolveSegmentRecipients(
  segmentId: string,
): Promise<SegmentRecipient[]> {
  const segment = await db.customerSegment.findUnique({ where: { id: segmentId } });
  if (!segment) return [];

  const criteria = parseCriteria(segment.criteria);

  if (criteria.leadType === "bulk_order") {
    const leads = await db.bulkOrderLead.findMany({
      where: { consentGiven: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return dedupeRecipients(
      leads.map((lead) => ({
        email: lead.email,
        phone: lead.phone,
        contactName: lead.contactPerson,
        firstName: lead.contactPerson.split(" ")[0],
        organization: lead.organization,
      })),
    );
  }

  if (criteria.source === "newsletter" || criteria.consent === true) {
    const subscribers = await db.newsletterSubscriber.findMany({
      where: { consentGiven: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    return dedupeRecipients(
      subscribers.map((subscriber) => ({
        email: subscriber.email,
        firstName: subscriber.email.split("@")[0],
      })),
    );
  }

  if (criteria.pages?.length) {
    const subscribers = await db.newsletterSubscriber.findMany({
      where: {
        consentGiven: true,
        source: { in: ["mix-match", "bespoke", "shop", "footer", "checkout"] },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    if (subscribers.length > 0) {
      return dedupeRecipients(
        subscribers.map((subscriber) => ({
          email: subscriber.email,
          firstName: subscriber.email.split("@")[0],
        })),
      );
    }

    const enquiries = await db.contactEnquiry.findMany({
      where: { type: { in: ["BULK_ORDER", "INSTITUTIONAL"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return dedupeRecipients(
      enquiries.map((enquiry) => ({
        email: enquiry.email,
        phone: enquiry.phone ?? undefined,
        contactName: enquiry.name,
        firstName: enquiry.name.split(" ")[0],
        organization: enquiry.organization ?? undefined,
      })),
    );
  }

  return [];
}
