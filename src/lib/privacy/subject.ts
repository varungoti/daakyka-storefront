import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/**
 * F-315: who a data-principal request (access / export / erasure) is about.
 * One person's data is copied into ~15 tables with no shared key — a
 * Customer row, Order.email/phone, ContactEnquiry, BulkOrderLead,
 * NewsletterSubscriber, JourneyEnrollment, EmailOutbox, AdminNotification
 * and more — so a request is resolved to the set of identifiers (email
 * addresses, phone numbers, and the Customer id when there is one) that
 * export.ts and erase.ts then match against every table the same way. Both
 * services use this one resolution so "what we export" and "what we erase"
 * can never drift apart.
 */

export interface PersonalDataSubject {
  customerId?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ResolvedSubject {
  /** The Customer row, when the subject has an account. */
  customerId: string | null;
  /** Lower-cased, de-duplicated. */
  emails: string[];
  /** Every spelling of each phone number the data is likely to hold. */
  phones: string[];
}

export class PrivacySubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacySubjectError";
  }
}

/** The ways one Indian mobile number is stored across the tables: as typed,
 * digits only, the bare 10 digits, and with a +91 / 91 prefix. */
export function phoneVariants(raw: string | null | undefined): string[] {
  const value = (raw ?? "").trim();
  if (!value) return [];
  const digits = value.replace(/\D/g, "");
  // Too short to identify anyone — matching on it (worst of all inside
  // free-text notification bodies) would sweep up other people's rows.
  if (digits.length < 7) return [];
  const variants = new Set<string>([value]);
  variants.add(digits);
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    variants.add(last10);
    variants.add(`+91${last10}`);
    variants.add(`91${last10}`);
  }
  return [...variants];
}

export function normaliseEmailForMatch(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolves a request to its identifiers. A Customer id or an email that
 * belongs to an account pulls in that account's email, phone and saved
 * address phones; a bare email or phone (a guest, a lead, an enquiry) is
 * used as given. Throws when there is nothing to match on at all.
 */
export async function resolveSubject(subject: PersonalDataSubject): Promise<ResolvedSubject> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  let customerId = subject.customerId ?? null;

  if (subject.email) emails.add(normaliseEmailForMatch(subject.email));
  for (const variant of phoneVariants(subject.phone)) phones.add(variant);

  const customer = customerId
    ? await db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, email: true, phone: true, addresses: { select: { phone: true } } },
      })
    : subject.email
      ? await db.customer.findUnique({
          where: { email: normaliseEmailForMatch(subject.email) },
          select: { id: true, email: true, phone: true, addresses: { select: { phone: true } } },
        })
      : null;

  if (customer) {
    customerId = customer.id;
    emails.add(normaliseEmailForMatch(customer.email));
    for (const variant of phoneVariants(customer.phone)) phones.add(variant);
    for (const address of customer.addresses) for (const variant of phoneVariants(address.phone)) phones.add(variant);
  } else if (subject.customerId) {
    // The account is already gone (a repeated request) — fall through with
    // whatever else was supplied.
    customerId = null;
  }

  if (!customerId && emails.size === 0 && phones.size === 0) {
    throw new PrivacySubjectError("An email address, a phone number or a customer is required");
  }
  return { customerId, emails: [...emails], phones: [...phones] };
}

/** A short, non-reversible reference for audit rows — the audit trail must
 * record that a request happened without itself storing the person's
 * address. */
export function subjectReference(subject: ResolvedSubject): string {
  const basis = subject.customerId ?? subject.emails[0] ?? subject.phones[0] ?? "unknown";
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}
