/**
 * Shared honeypot field for public, unauthenticated forms (contact,
 * bulk orders, newsletter). A real visitor never sees or fills this
 * field (see HoneypotField); a bot that blindly fills every input in
 * the form does. Route handlers check isHoneypotTripped() and return a
 * fake success without actually processing the submission, so the bot
 * gets no signal that it was caught and has no reason to adapt.
 *
 * Deliberately zod-free: this module is imported by the client-side
 * NewsletterSignup form (rendered in the footer on every storefront
 * route) purely for the HONEYPOT_FIELD_NAME string constant. A
 * `honeypotSchema = z.object(...)` used to live here too, unused by
 * every caller (isHoneypotTripped below is a hand-rolled check, not
 * schema-based) — but because bundlers include a whole module's
 * top-level code once any export is imported, that dead zod schema was
 * enough to pull the entire zod library into the client bundle on
 * every page (~60 KiB transferred, ~52 KiB of it unused per Lighthouse
 * — see docs/PERFORMANCE.md). Keep server-side honeypot schemas (if
 * ever needed) in a separate, server-only module instead of here.
 */
export const HONEYPOT_FIELD_NAME = "company_website";

export function isHoneypotTripped(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const value = (data as Record<string, unknown>)[HONEYPOT_FIELD_NAME];
  return typeof value === "string" && value.trim().length > 0;
}
