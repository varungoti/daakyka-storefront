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
// F-157: this used to be "company_website", which Chrome's address autofill
// matches on "company" (it also ignores autocomplete="off") — a buyer who
// autofilled a form with an Organization field could populate the honeypot
// and have a real lead silently dropped behind a fake success. The name is
// deliberately meaningless to every autofill / password-manager heuristic;
// don't rename it back to anything that reads like a real field
// (company, website, url, address, phone, ...). The server no longer looks
// at the old name, so a tab opened before the rename that autofilled it is
// processed normally instead of discarded.
export const HONEYPOT_FIELD_NAME = "hp_x9k2";

/**
 * True when a bot filled the honeypot. `source` (the route name, e.g.
 * "contact") is logged — never the payload — so a spike of trips from real
 * visitors (a false positive, i.e. lost leads) is visible in the runtime
 * logs instead of vanishing behind the fake success every caller returns.
 */
export function isHoneypotTripped(data: unknown, source?: string): boolean {
  if (!data || typeof data !== "object") return false;
  const value = (data as Record<string, unknown>)[HONEYPOT_FIELD_NAME];
  const tripped = typeof value === "string" && value.trim().length > 0;
  if (tripped) console.warn(`[honeypot] tripped${source ? ` on ${source}` : ""}`);
  return tripped;
}
