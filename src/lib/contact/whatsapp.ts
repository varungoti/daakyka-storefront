/**
 * Builds a wa.me deep link from a phone number in any common format (e.g.
 * "+91 95530 94251") — wa.me only accepts digits, no "+" or spaces.
 *
 * F-002/F-126: the floating WhatsApp bubble and the WhatsApp CTAs on
 * /bulk-orders and /contact used to build `https://wa.me/?text=...` with no
 * number at all, which opens WhatsApp's "choose a contact to send to"
 * picker instead of a chat with the business. This is the single
 * implementation every WhatsApp link should go through (the utility bar
 * already had an equivalent local copy; this is that logic, shared).
 *
 * If `phone` has no digits at all (should not happen for the validated
 * `contact.whatsapp` SiteSetting — see settingSchemas' min(6) in
 * src/lib/settings/index.ts — but a defensive fallback is cheap), this
 * still returns a numberless `wa.me/?text=` link rather than throwing, so a
 * misconfigured setting degrades to today's known-bad-but-non-crashing
 * behaviour instead of breaking the page.
 */
export function whatsappHref(phone: string, message: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
