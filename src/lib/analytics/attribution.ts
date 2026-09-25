/**
 * F-318 fix (release-hardening schema-foundation): best-effort first-party
 * marketing attribution, captured entirely server-side from the request
 * that's already hitting the API (checkout, contact, bulk-order) — no
 * client-side tracking script, cookie or sessionStorage involved. That
 * keeps this package's scope to "orders/leads aren't attributed to
 * anything at all" rather than standing up real analytics (Vercel Web
 * Analytics, GA4, a client-side UTM-capture helper) — see the parent
 * finding's `suggested_fix` for the fuller version a later package may
 * build on top of this.
 *
 * Two sources, first-present-wins per field:
 *   1. The request's own query string — covers a client that appends the
 *      current page's UTM params itself (e.g. `fetch('/api/contact?' +
 *      window.location.search)`).
 *   2. The `Referer` header — the page that issued this request. Its own
 *      query string is checked for the same UTM params (covers a landing
 *      page that linked straight to an API-backed form), and its
 *      origin+pathname (query string stripped — never store a referrer's
 *      query string verbatim, it can carry tokens or other identifiers
 *      that don't belong in an Order/lead row) becomes `referrer`.
 *
 * Every field is optional and this never throws — a missing or malformed
 * URL/header just means less attribution, never a failed request.
 */
export interface RequestAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
}

const MAX_FIELD_LENGTH = 255;

function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD_LENGTH) : null;
}

export function extractRequestAttribution(request: Request): RequestAttribution {
  let utmSource: string | null = null;
  let utmMedium: string | null = null;
  let utmCampaign: string | null = null;
  let referrer: string | null = null;

  try {
    const ownParams = new URL(request.url).searchParams;
    utmSource = clip(ownParams.get("utm_source"));
    utmMedium = clip(ownParams.get("utm_medium"));
    utmCampaign = clip(ownParams.get("utm_campaign"));
  } catch {
    // Malformed request.url — never fatal, just no query-param attribution.
  }

  const refererHeader = request.headers.get("referer");
  if (refererHeader) {
    try {
      const refererUrl = new URL(refererHeader);
      utmSource ??= clip(refererUrl.searchParams.get("utm_source"));
      utmMedium ??= clip(refererUrl.searchParams.get("utm_medium"));
      utmCampaign ??= clip(refererUrl.searchParams.get("utm_campaign"));
      referrer = clip(refererUrl.origin + refererUrl.pathname);
    } catch {
      // Malformed Referer header — ignore, same best-effort contract.
    }
  }

  return { utmSource, utmMedium, utmCampaign, referrer };
}
