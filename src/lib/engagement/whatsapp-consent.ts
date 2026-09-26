import { db } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/validation/india";

/**
 * F-266/F-317 fix: a WATI-ready phone number (digits only, carrying its
 * country code) shared by every WhatsApp send path (journey-engine.ts,
 * campaign-dispatcher.ts, providers/whatsapp.ts) and by the WhatsAppOptIn
 * consent lookup below, so a read and a write of the same real-world number
 * always land on the same key — a bare "98765 43210" from a form must
 * resolve to the exact same string as "+91 98765 43210" or "919876543210".
 *
 * Indian numbers (the overwhelming majority of leads/customers) are
 * normalised via the shared normalizeIndianPhone (10 digits) and given the
 * `91` country code WATI requires. A number that isn't a recognisable
 * Indian mobile number but still looks like a full international number
 * (11-15 digits, no leading 0) is passed through as-is on the assumption it
 * already carries its own country code. Anything else can't be turned into
 * a valid WhatsApp-addressable number, so this returns null rather than
 * silently sending to a malformed one.
 */
export function normalizeWhatsAppPhone(raw: string): string | null {
  if (typeof raw !== "string") return null;

  const indian = normalizeIndianPhone(raw);
  if (indian) return `91${indian}`;

  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) {
    return digits;
  }

  return null;
}

/**
 * engagement_compliance (F-317): the WhatsAppOptIn table is the source of
 * truth for whether a phone number may receive a business-initiated WATI
 * marketing/broadcast send — see its schema comment. Returns false for a
 * phone that never opted in, that opted out (`optedOutAt` set), or that
 * can't be normalised into a WATI-ready number at all.
 */
export async function hasWhatsAppMarketingConsent(phone: string | undefined | null): Promise<boolean> {
  if (!phone) return false;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return false;

  const optIn = await db.whatsAppOptIn.findUnique({ where: { phone: normalized } });
  return Boolean(optIn && !optIn.optedOutAt);
}
