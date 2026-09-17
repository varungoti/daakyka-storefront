import { z } from "zod";

/**
 * Shared honeypot field for public, unauthenticated forms (contact,
 * bulk orders, newsletter). A real visitor never sees or fills this
 * field (see HoneypotField); a bot that blindly fills every input in
 * the form does. Route handlers check isHoneypotTripped() and return a
 * fake success without actually processing the submission, so the bot
 * gets no signal that it was caught and has no reason to adapt.
 */
export const HONEYPOT_FIELD_NAME = "company_website";

export const honeypotSchema = z.object({
  [HONEYPOT_FIELD_NAME]: z.string().optional(),
});

export function isHoneypotTripped(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const value = (data as Record<string, unknown>)[HONEYPOT_FIELD_NAME];
  return typeof value === "string" && value.trim().length > 0;
}
