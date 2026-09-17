import { safeEquals } from "@/lib/security/timing-safe-equal";

/**
 * The Hermes runtime is a separate trust domain from cron — it accepts
 * an AI task type and dispatches an LLM call, so it needs its own
 * dedicated credential rather than reusing CRON_SECRET. Deny by default
 * when HERMES_API_KEY isn't set, rather than leaving the endpoint open,
 * since a preview/staging deploy that forgets to set it would otherwise
 * let anyone run up the configured LLM provider's bill.
 */
export function authorizeHermesRuntime(request: Request): boolean {
  const expected = process.env.HERMES_API_KEY;
  if (!expected) return false;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  return safeEquals(header.slice("Bearer ".length), expected);
}
