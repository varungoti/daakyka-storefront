/**
 * Release-hardening item 2 — courier tracking link decision.
 *
 * `Order.courier` (prisma/schema.prisma) is free text typed by an admin
 * into a plain `<input>` (src/components/admin/order-detail-actions.tsx)
 * — there is no enum, no canonical carrier id, and no validation. Turning
 * that string into a working "track your package" URL means guessing
 * both (a) which real-world courier the admin meant, and (b) that
 * courier's current tracking URL scheme.
 *
 * Both were checked empirically before writing this file, not assumed:
 * a live-browser check of a plausible Delhivery tracking URL
 * (`/track-v2/package/<awb>`) redirected straight to their homepage —
 * i.e. a "reasonable-looking" guess for one of the most common Indian
 * couriers was simply wrong. Indian domestic carriers (Delhivery, Blue
 * Dart, DTDC, Ecom Express, XpressBees, India Post/Speed Post, Ekart,
 * Shadowfax — the couriers this store would actually realistically use)
 * are therefore deliberately NOT included here: shipping a wrong/broken
 * link would be worse than showing no link at all, which is the explicit
 * fallback the release brief calls for.
 *
 * FedEx and DHL Express are included because (1) their query-string
 * tracking URL scheme is long-established, publicly documented, and used
 * identically across virtually every e-commerce/shipping integration,
 * and (2) a live check during this change confirmed both URLs route to a
 * carrier-hosted tracking view keyed by the query param (not a generic
 * homepage) rather than just being assumed correct.
 *
 * Extending this list: only add a courier here after independently
 * confirming its current tracking URL scheme (e.g. by loading it with a
 * real tracking number and checking it resolves to that shipment, not a
 * generic search page) — see the investigation note above. Matching is
 * case/whitespace/punctuation-insensitive on the admin's free-text value
 * so "FedEx", "Fed Ex" and "FEDEX" all resolve the same way; anything
 * that doesn't match a confirmed entry returns null, and callers must
 * fall back to rendering the tracking number as copyable plain text
 * rather than a link (src/components/account/order-tracking-card.tsx).
 */

type CourierKey = "fedex" | "dhl";

const COURIER_URL_BUILDERS: Record<CourierKey, (trackingNumber: string) => string> = {
  fedex: (trackingNumber) => `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
  dhl: (trackingNumber) => `https://www.dhl.com/in-en/home/tracking.html?tracking-id=${trackingNumber}`,
};

const COURIER_ALIASES: Record<string, CourierKey> = {
  fedex: "fedex",
  dhl: "dhl",
  dhlexpress: "dhl",
};

function normalizeCourierName(courier: string): string {
  return courier.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Returns a working tracking URL only for couriers whose scheme has been
 * independently verified (see the module doc comment above) — null for
 * everything else, including any courier this store realistically ships
 * with today. Callers must treat null as "show copyable text, not a
 * link", never fall back to a guessed URL.
 */
export function getCourierTrackingUrl(
  courier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (!courier || !trackingNumber) return null;
  const trimmedTrackingNumber = trackingNumber.trim();
  if (!trimmedTrackingNumber) return null;

  const key = COURIER_ALIASES[normalizeCourierName(courier)];
  if (!key) return null;

  return COURIER_URL_BUILDERS[key](encodeURIComponent(trimmedTrackingNumber));
}
