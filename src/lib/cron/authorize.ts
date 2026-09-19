import { isProduction } from "@/lib/env";
import { safeEquals } from "@/lib/security/timing-safe-equal";

/**
 * F9 fix (docs/audit-2026-09-19/security.md): CRON_SECRET is now required
 * unconditionally. The previous `NODE_ENV === "development"` bypass meant
 * an ordinary `next dev` run with no CRON_SECRET configured left every
 * /api/cron/* route publicly triggerable by anyone who could reach the
 * server — NODE_ENV reflects the build mode, not who can reach it, so
 * "development" is not a safe proxy for "trusted network." (This build
 * happened to verify fail-closed only because NODE_ENV was "production"
 * here, not because the check was actually environment-aware.)
 *
 * CRON_ALLOW_UNAUTHENTICATED is a separate, explicit, narrowly-scoped
 * opt-in for a test/CI harness that intentionally exercises the
 * "no secret configured" path without wanting to fail closed — it's
 * inert whenever isProduction() is true (belt-and-suspenders on top of
 * validateEnv() in src/lib/env.ts already refusing to boot a Vercel
 * production deployment without CRON_SECRET set at all), so it can't be
 * left on by accident in a real deployment the way the old NODE_ENV
 * check could.
 */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.CRON_ALLOW_UNAUTHENTICATED === "1" && !isProduction()) {
      return true;
    }
    console.error(
      "[cron] Rejecting request: CRON_SECRET is not set, so every cron route is denying " +
        "all requests. Set CRON_SECRET in this environment (locally: add it to .env; on " +
        "Vercel: add it as a Project Environment Variable) to authenticate cron calls. A " +
        "test/CI run that intentionally has no secret configured should set " +
        "CRON_ALLOW_UNAUTHENTICATED=1 instead of leaving CRON_SECRET unset.",
    );
    return false;
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return safeEquals(header.slice("Bearer ".length), secret);
}
