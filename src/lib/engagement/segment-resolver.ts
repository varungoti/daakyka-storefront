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

  // engagement_compliance: a marketing send may only go to a subscriber who
  // (a) opted in (consentGiven), (b) confirmed via the double opt-in link
  // (confirmedAt set) and (c) hasn't since unsubscribed. `consentGiven` was
  // flagged separately as defaulting to true with no real checkbox behind
  // it and has since been fixed at the schema level (see
  // NewsletterSubscriber in prisma/schema.prisma) — confirmedAt/
  // unsubscribedAt are the two checks that actually matter now, but
  // consentGiven is kept in the filter as defense in depth.
  const marketingConsentFilter = {
    consentGiven: true,
    confirmedAt: { not: null },
    unsubscribedAt: null,
  } as const;

  if (criteria.source === "newsletter" || criteria.consent === true) {
    const subscribers = await db.newsletterSubscriber.findMany({
      where: marketingConsentFilter,
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
        ...marketingConsentFilter,
        source: { in: ["mix-match", "bespoke", "shop", "footer", "checkout"] },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    // engagement_compliance: this used to fall back to ContactEnquiry rows
    // (type BULK_ORDER/INSTITUTIONAL) when no matching subscribers were
    // found — flagged in the compliance audit as a real issue: someone who
    // filed a contact enquiry about THEIR OWN question consented to being
    // contacted about that enquiry, not to being added to a marketing
    // segment. Removed entirely for this (marketing) resolution path; an
    // empty consented-subscriber list now just means an empty recipient
    // list, not "substitute a different audience that never opted in".
    return dedupeRecipients(
      subscribers.map((subscriber) => ({
        email: subscriber.email,
        firstName: subscriber.email.split("@")[0],
      })),
    );
  }

  return [];
}
