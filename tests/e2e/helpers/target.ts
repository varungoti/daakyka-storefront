import { isLocalTarget, isProductionTarget } from "../../../scripts/lib/assert-not-production.mjs";

/**
 * Where this Playwright run points, and which tests may therefore write.
 *
 * The suites double as the remote gates (`verify:staging`), but several tests
 * change data that nothing puts back: they queue Hermes tasks and call the
 * paid try-on API (F-077). Those must never run against the live store, and
 * against a real staging deployment only when the operator opts in with
 * E2E_ALLOW_MUTATIONS=1. A server this machine started (localhost) is
 * disposable, so everything runs there.
 *
 * Tests that DO restore what they change (the homepage hero, blog drafts)
 * run anywhere except production.
 */
export const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export const targetIsLocal = isLocalTarget(baseUrl);
export const targetIsProduction = isProductionTarget(baseUrl);

/** Writes that are cleaned up afterwards: everywhere but the live store. */
export const restorableWritesAllowed = !targetIsProduction;

/** Writes that leave residue (queued tasks, paid API calls). */
export const residueWritesAllowed =
  !targetIsProduction && (targetIsLocal || process.env.E2E_ALLOW_MUTATIONS === "1");

export const restorableWritesSkipReason =
  "this test writes data and the target is the production store (see scripts/lib/assert-not-production.mjs)";

export const residueWritesSkipReason =
  "this test leaves data behind (or calls a paid API); it only runs against a local server, or a staging " +
  "deployment with E2E_ALLOW_MUTATIONS=1, never production";
