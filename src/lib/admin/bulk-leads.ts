import type { BulkLeadStatus } from "@/generated/prisma/client";
import { firstParam, type RawSearchParam } from "@/lib/admin/pagination";

/**
 * F-196: pure helpers for the Bulk Order Manager list page — the `?status=`
 * filter, the page size, and the WhatsApp deep link — kept out of the page
 * component (no React, no Prisma runtime) so they are unit-testable
 * directly.
 */

/** Leads per page. Each lead renders both a table row and a stacked card
 * (the CSS hides one), so this is half what a single-layout list could
 * afford; 25 keeps a phone's page to a few screens. */
export const BULK_LEADS_PAGE_SIZE = 25;

/** The statuses the filter chips offer — the same set BulkLeadStatusSelect
 * and the PATCH route accept. */
export const BULK_LEAD_STATUS_FILTERS = [
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "QUOTED", label: "Quoted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
] as const satisfies readonly { value: BulkLeadStatus; label: string }[];

/** A `?status=` value only filters when it is one of the real statuses
 * (exact, upper-case) — anything else, including a repeated or garbage
 * param, means "all" rather than an error or an empty list. It is also
 * what keeps an unvalidated URL string out of the Prisma `where`. */
export function parseBulkLeadStatusFilter(raw: RawSearchParam): BulkLeadStatus | undefined {
  const value = firstParam(raw);
  return BULK_LEAD_STATUS_FILTERS.find((filter) => filter.value === value)?.value;
}

/** wa.me needs a bare, country-coded digit string — strips everything
 * else and, for a 10-digit Indian mobile with no country code typed,
 * prefixes 91. Returns null when what's left doesn't look like a usable
 * number, so no dead WhatsApp link is ever rendered. */
export function whatsappLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  if (withCountryCode.length < 11 || withCountryCode.length > 15) return null;
  return `https://wa.me/${withCountryCode}`;
}

/** `tel:` href for a free-form phone ("+91 98765-43210" → "tel:+919876543210"):
 * spaces, dashes and brackets stripped, a leading "+" kept. Falls back to
 * the raw text when nothing dialable is left, so the link never goes empty. */
export function telHref(phone: string): string {
  const dialable = phone.replace(/[^\d+]/g, "");
  return `tel:${dialable || phone}`;
}
