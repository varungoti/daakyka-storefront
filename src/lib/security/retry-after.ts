/**
 * F-323/F-324: a shared "how long do I wait" formatter for any client
 * (storefront form, admin upload widget) that gets a 429 back from a
 * DB-backed rate limit (src/lib/security/rate-limit.ts's
 * tooManyRequestsResponse, order-request-throttle.ts, etc — all of which
 * always set a Retry-After header on a 429).
 *
 * Several forms used to treat *every* non-OK response the same way — a
 * newsletter signup that hit its rate limit was told "Please enter a
 * valid email", a bulk-order enquiry was told to "check all required
 * fields" — sending a throttled user off to fix input that was never
 * wrong. This is deliberately framework/component-agnostic (no React, no
 * server-only imports) so it works from any "use client" component.
 */
export function retryAfterMessage(response: Response, subject = "attempts"): string {
  const raw = response.headers.get("Retry-After");
  const seconds = raw ? Number(raw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    const unit = seconds === 1 ? "second" : "seconds";
    return `Too many ${subject} from this network. Please wait ${seconds} ${unit} and try again.`;
  }
  return `Too many ${subject} from this network. Please wait a moment and try again.`;
}
