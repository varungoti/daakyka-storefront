/**
 * Keeps the remote verification gates from running mutating tests against the
 * live store (F-077).
 *
 * `verify:staging:full` used to default to https://storefront-nu-woad.vercel.app
 * — which `vercel inspect` shows is the PRODUCTION alias, not a staging
 * deployment — and then ran E2E and dogfood suites that overwrite the
 * homepage hero, create blog drafts and queue Hermes tasks. This module is the
 * one place that knows what "production" means for those scripts and for the
 * Playwright helpers that decide whether a mutating test may run.
 *
 * Hosts are compared, never raw strings: a trailing slash, http vs https or
 * upper case must not slip a production URL past the check. Preview URLs
 * (`storefront-<hash>-varubs-projects.vercel.app`) are NOT production and are
 * not matched; only the aliases below are.
 */

/** Hosts that always mean the live store. */
export const KNOWN_PRODUCTION_HOSTS = [
  "storefront-nu-woad.vercel.app",
  "storefront-varubs-projects.vercel.app",
  "daakyka.com",
  "www.daakyka.com",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function hostOf(value) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Every host this run must treat as production: the known aliases, the host of
 * NEXT_PUBLIC_SITE_URL / RELEASE_PUBLIC_URL when set, and any comma-separated
 * PRODUCTION_HOSTS the operator adds (a new custom domain, say).
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {Set<string>}
 */
export function productionHosts(env = process.env) {
  const hosts = new Set(KNOWN_PRODUCTION_HOSTS);
  for (const value of [env.NEXT_PUBLIC_SITE_URL, env.RELEASE_PUBLIC_URL]) {
    const host = hostOf(value);
    // A local NEXT_PUBLIC_SITE_URL (the usual dev value) is not production.
    if (host && !LOCAL_HOSTS.has(host)) hosts.add(host);
  }
  for (const entry of (env.PRODUCTION_HOSTS ?? "").split(",")) {
    const host = hostOf(entry.trim());
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * True when `baseUrl` is (or cannot be proven not to be) the live store.
 *
 * @param {string | undefined} baseUrl
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isProductionTarget(baseUrl, env = process.env) {
  const host = hostOf(baseUrl);
  // An unparseable target is refused rather than guessed at.
  return host === null || productionHosts(env).has(host);
}

/** True for localhost / 127.0.0.1 / ::1 — a server this machine started. */
export function isLocalTarget(baseUrl) {
  const host = hostOf(baseUrl);
  return host !== null && LOCAL_HOSTS.has(host);
}

/**
 * The reason a mutating verification run must not target `baseUrl`, or null
 * when it may. `readOnly` is the explicit `--production-readonly` opt-in: the
 * caller then promises to run GET-only checks.
 *
 * @param {string | undefined} baseUrl
 * @param {{ readOnly?: boolean, env?: NodeJS.ProcessEnv | Record<string, string | undefined> }} [options]
 * @returns {string | null}
 */
export function productionTargetProblem(baseUrl, options = {}) {
  const { readOnly = false, env = process.env } = options;
  if (!baseUrl) return "no target URL was given.";
  if (!isProductionTarget(baseUrl, env)) return null;
  if (readOnly) return null;
  return (
    `${hostOf(baseUrl) ?? baseUrl} is the PRODUCTION store, and this gate runs tests that write data ` +
    "(homepage hero edits, blog drafts, Hermes tasks). Point it at a real Preview/staging deployment, or pass " +
    "--production-readonly to run only the GET-only checks against production."
  );
}
