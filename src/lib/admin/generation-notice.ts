/**
 * F-292: POST /api/admin/media/generate answers a refused request with one
 * of several statuses, and the Site Images card used to special-case only
 * two of them — anything else, a 403 included, fell through to the same
 * "Generation failed — try again" line, which for a role that lacks
 * `ai:generate` (CONTENT_EDITOR can manage media but not generate it) is
 * false: retrying can never work. This maps each status to copy that says
 * what is actually wrong. Pure so it's unit-testable without a DOM.
 */

/** The generic body `requireAdminPermission` sends for a 403 — see
 * src/lib/auth/admin-api.ts. A 403 carrying any *other* message came from
 * the route itself (a slot that must stay a real photo) and is worth
 * showing as written. */
const GENERIC_FORBIDDEN = "Forbidden";

export function generationFailureNotice(status: number, serverMessage?: unknown): string {
  switch (status) {
    case 503:
      return "AI image generation isn't configured yet — add OPENAI_API_KEY to enable this.";
    case 429:
      return "Daily AI image limit reached — try again tomorrow, or upload an image instead.";
    case 403:
      return typeof serverMessage === "string" && serverMessage.trim() && serverMessage !== GENERIC_FORBIDDEN
        ? serverMessage
        : "Your role can upload images but can't generate them with AI — upload an image instead.";
    default:
      return "Generation failed — try again or upload an image instead.";
  }
}
