/**
 * Release-hardening Finding A: shared India-specific phone/PIN-code format
 * rules and normalisation.
 *
 * Framework-agnostic on purpose (no zod, no React) — this same logic backs
 * both the server-side Zod schemas (src/lib/validation/schemas.ts, via a
 * small `.transform()` wrapper defined there) and the client-side inline
 * validation in the checkout and saved-address forms
 * (src/components/checkout/checkout-page-content.tsx,
 * src/components/account/account-tabs.tsx), so the exact same rule runs in
 * both places instead of the two slowly drifting apart. Being dependency-
 * free also keeps it cheap to import from a "use client" component.
 *
 * Before this, neither layer validated format at all: a checkout could be
 * (and was, per the live audit) placed with phone "12345" and pincode
 * "AB123" — only an empty "Full name" field was ever blocked, by the
 * browser's native `required`.
 */

/**
 * Indian mobile numbers are 10 digits, and TRAI only allocates the mobile
 * range to numbers starting 6-9. A caller may write the number with a
 * leading +91 / 91 (ISD/STD code) or a leading trunk-prefix 0, and with
 * spaces, hyphens, dots or parentheses anywhere — all of that is stripped
 * before the 10-digit rule is checked. Returns the canonical bare
 * 10-digit string to store, or `null` if the input can't be read as a
 * valid Indian mobile number.
 */
export function normalizeIndianPhone(raw: string): string | null {
  if (typeof raw !== "string") return null;

  const digits = raw.replace(/\D/g, "");
  let candidate = digits;

  // Only strip a leading country/trunk code when the total length matches
  // exactly what that prefix implies — otherwise a plain 10-digit mobile
  // number that happens to start "91" (e.g. 91xxxxxxxx, a legitimate
  // mobile number) is never mistaken for a prefixed one.
  if (candidate.length === 12 && candidate.startsWith("91")) {
    candidate = candidate.slice(2);
  } else if (candidate.length === 11 && candidate.startsWith("0")) {
    candidate = candidate.slice(1);
  }

  return /^[6-9]\d{9}$/.test(candidate) ? candidate : null;
}

/**
 * Indian PIN codes are exactly 6 digits; India Post never issues one
 * starting with 0. Spaces (people sometimes write "560 001") are
 * stripped before the check. Returns the canonical 6-digit string, or
 * `null` if the input isn't a valid PIN code.
 */
export function normalizeIndianPincode(raw: string): string | null {
  if (typeof raw !== "string") return null;

  const digits = raw.replace(/\D/g, "");
  return /^[1-9]\d{5}$/.test(digits) ? digits : null;
}

export const INDIAN_PHONE_HINT = "Enter a valid 10-digit Indian mobile number (e.g. 98765 43210)";
export const INDIAN_PINCODE_HINT = "Enter a valid 6-digit PIN code (e.g. 500032)";
