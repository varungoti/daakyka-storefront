/**
 * Release-hardening F-02: several admin forms (product, category, size
 * chart, site controls) either showed nothing at all on a failed save, or
 * dumped the API's generic `error` string ("Invalid request" /
 * "Validation failed") without the actual per-field reason — see
 * docs/audit-2026-09-19/admin-ux.md F-02. Every admin route in this app
 * rejects a bad request in one of two shapes:
 *
 *  - A Zod validation failure: `{ error: "<generic>", issues: ZodIssue[] }`
 *    (see src/lib/validation/schemas.ts and the *InputSchema definitions
 *    across src/lib/catalog/**). The generic `error` string is never
 *    useful on its own — each issue's own `message`, at its own `path`, is
 *    what an admin needs to fix the form.
 *  - A thrown domain error (slug conflict, not-found, etc.), surfaced as
 *    `{ error: "<human-readable message>" }` with no `issues` array. That
 *    message is already meant to be read as-is.
 *
 * `formatApiError` is the one place that turns either shape (or a
 * malformed/non-JSON response, or a network hiccup) into copy an admin can
 * act on: a single-line summary for a banner, plus a per-field message map
 * for inline errors under the matching input.
 */

export interface ApiIssue {
  path?: Array<string | number>;
  message?: string;
}

export interface FormattedApiError {
  /** Always non-empty — safe to render directly in a banner. */
  summary: string;
  /** Keyed by the issue's `path` joined with ".", e.g. "price" or
   * "shippingAddress.city". First issue per path wins. Empty when the
   * failure had no field-level detail (e.g. a plain domain error). */
  fieldErrors: Record<string, string>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param body The already-`await`ed (and `.catch(() => ({}))`-guarded)
 *   JSON body of a failed `fetch` response. Never assumed to be
 *   well-formed — a 500 from an unrelated bug, a proxy error page, or a
 *   `.catch` fallback of `{}` can all land here.
 * @param fallback Shown when the body has neither a usable `issues` array
 *   nor a non-empty `error` string.
 */
export function formatApiError(body: unknown, fallback: string): FormattedApiError {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawIssues = Array.isArray(record.issues) ? (record.issues as ApiIssue[]) : [];

  const fieldErrors: Record<string, string> = {};
  const messages: string[] = [];

  for (const issue of rawIssues) {
    if (!issue || !isNonEmptyString(issue.message)) continue;
    messages.push(issue.message);
    const key = Array.isArray(issue.path) ? issue.path.join(".") : "";
    if (key && !(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }

  let summary: string;
  if (messages.length === 1) {
    summary = messages[0];
  } else if (messages.length > 1) {
    summary = messages.join(" ");
  } else if (isNonEmptyString(record.error)) {
    summary = record.error;
  } else {
    summary = fallback;
  }

  return { summary, fieldErrors };
}
