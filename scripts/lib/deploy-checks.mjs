/**
 * Pure, dependency-free checks used by scripts/go-live.mjs's preflight and
 * smoke stages, split out into their own module so each rule — "what
 * counts as a blocked robots.txt", "what counts as an SSO-protected Vercel
 * alias", "does this .vercelignore actually cover the .env family" — has a
 * single, unit-tested home instead of living inline in a script nobody
 * runs in CI (see scripts/lib/deploy-checks.test.ts).
 *
 * Two release-hardening findings drove this:
 *
 *   F-054: a leftover NEXT_PUBLIC_ALLOW_INDEXING=false from when this URL
 *   was staging silently blocked all search indexing on production, and
 *   go-live.mjs's smoke check (a bare 200 + a text match) reported success
 *   anyway. NEXT_PUBLIC_ALLOW_INDEXING is a legitimate kill switch (see
 *   src/lib/env.ts's isIndexingAllowed) — this must never *fail* the
 *   deploy, only make its state impossible to miss.
 *
 *   F-228: with no .vercelignore, the Vercel CLI's own default ignore list
 *   (`.env.local` / `.env.*.local` only — it does not read .gitignore)
 *   uploaded the developer's `.env`, complete with the production DB URL
 *   and every API key, into every `vercel --prod` deploy this script runs.
 */

/**
 * True when a robots.txt body disallows crawling of the whole site — what
 * src/app/robots.ts emits when isIndexingAllowed() returns false: a single
 * `Disallow: /` rule and no `Allow`/`Sitemap` line.
 */
export function robotsTxtBlocksAll(body) {
  const hasBareDisallowRoot = /^Disallow:\s*\/\s*$/im.test(body);
  const hasAllow = /^Allow:/im.test(body);
  return hasBareDisallowRoot && !hasAllow;
}

/** True when the robots.txt body carries a `Sitemap:` line. */
export function robotsTxtHasSitemap(body) {
  return /^Sitemap:\s*\S+/im.test(body);
}

/** True when the rendered `<head>` carries a noindex robots meta tag. */
export function homepageHasNoindexMeta(html) {
  return /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
}

/** Extracts the canonical URL's href from a page's HTML, or null. */
export function extractCanonicalHref(html) {
  return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
}

/**
 * Vercel's team-scoped default alias (`<project>-<team>-projects.vercel.app`)
 * has Deployment Protection (an SSO wall) enabled by default, unlike the
 * project's own public `<project>-<hash>.vercel.app` alias. Used to flag
 * NEXT_PUBLIC_SITE_URL / the rendered canonical pointing at the protected
 * one (F-007) — every emailed order/unsubscribe/back-in-stock link and
 * every crawler request would hit a Vercel login page instead of the site.
 */
export function isLikelyProtectedVercelAlias(urlString) {
  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return false;
  }
  return hostname.endsWith("-projects.vercel.app");
}

/**
 * F-354: go-live.mjs used to pick the deployment URL to smoke-test by
 * regexing the `vercel --prod` CLI's own stdout+stderr for the last
 * `https://*.vercel.app` substring it could find — no preference between
 * the project's public alias, its SSO-protected team-scoped alias, or a
 * custom domain, and nothing that ever picked a custom domain at all.
 * This instead picks a hostname out of a parsed `vercel inspect
 * --format=json <deployment>` object: prefer a custom domain over any
 * `*.vercel.app` alias, and the public `<project>-<hash>.vercel.app`
 * alias over the SSO-protected `-projects.vercel.app` one (F-007).
 *
 * Deliberately schema-tolerant — it scans for any hostname-shaped string
 * anywhere in the object rather than reading one specific field — because
 * `vercel inspect`'s JSON shape isn't a documented, versioned contract.
 */
export function pickProductionHostname(inspectJson) {
  const hostnames = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const match = value.match(
        /^(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\/?$/i,
      );
      if (match) hostnames.add(match[1].toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(inspectJson);

  const isVercelApp = (host) => host.endsWith(".vercel.app");
  const isProtectedAlias = (host) => host.endsWith("-projects.vercel.app");

  const custom = [...hostnames].find((host) => !isVercelApp(host));
  if (custom) return custom;
  const publicAlias = [...hostnames].find((host) => isVercelApp(host) && !isProtectedAlias(host));
  if (publicAlias) return publicAlias;
  return [...hostnames][0] ?? null;
}

/** True for any HTTP redirect status (3xx). */
export function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

/**
 * True when a redirect `Location` header points at Vercel's own SSO wall
 * (`vercel.com/sso-api`) rather than anywhere on the app's own domain —
 * what Deployment Protection sends every unauthenticated request to.
 */
export function isSsoRedirectLocation(location) {
  if (!location) return false;
  try {
    return new URL(location, "https://placeholder.invalid").hostname === "vercel.com";
  } catch {
    return false;
  }
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Grep-style check that a `.vercelignore`'s text actually excludes every
 * real `.env` variant while still letting the committed `.env*.example`
 * templates through. Mirrors gitignore/vercelignore's own "last matching
 * line wins, negation included" semantics rather than a full glob engine,
 * which is all these simple patterns need.
 */
export function vercelIgnoreCoversEnvSecrets(vercelIgnoreText) {
  const lines = vercelIgnoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  function isIgnored(name) {
    let ignored = false;
    for (const rawLine of lines) {
      const negate = rawLine.startsWith("!");
      const pattern = negate ? rawLine.slice(1) : rawLine;
      if (globToRegExp(pattern).test(name)) {
        ignored = !negate;
      }
    }
    return ignored;
  }

  const mustBeIgnored = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    // Stands in for any future .env variant nobody has explicitly listed
    // yet — the whole point of a broad `.env*` rule over an enumerated one.
    ".env.some-future-variant",
  ];
  const mustNotBeIgnored = [".env.local.example", ".env.staging.example"];

  return (
    mustBeIgnored.every((name) => isIgnored(name)) &&
    mustNotBeIgnored.every((name) => !isIgnored(name))
  );
}

/**
 * F-371: how a Postgres connection string pins TLS, as far as node-postgres
 * (pg 8.x / pg-connection-string 2.x) is concerned. Returns:
 *
 *   "missing"       no sslmode at all (and no ssl=true): pg opens a plaintext
 *                   connection unless the server insists on TLS.
 *   "legacy-alias"  sslmode=prefer|require|verify-ca. pg 8 treats these as
 *                   aliases for verify-full and prints a SECURITY WARNING on
 *                   every process start (error severity on Vercel); pg 9 will
 *                   switch them to weaker libpq semantics, silently loosening
 *                   certificate checks on the next major bump.
 *   "unverified"    sslmode=disable|allow|no-verify (or anything unknown).
 *   null            explicit and fine: sslmode=verify-full, an explicit
 *                   uselibpqcompat=true (a reviewed choice), ssl=true, a
 *                   loopback host, or not a Postgres URL at all.
 *
 * Mirrors databaseSslModeIssue() in src/lib/env.ts. That one runs inside the
 * app; this copy exists because check-deploy-env.mjs runs under plain `node`,
 * before any TypeScript loader. deploy-checks.test.ts keeps the two in step.
 */
export function databaseUrlSslModeIssue(databaseUrl) {
  if (!databaseUrl) return null;
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return null;

  const params = parsed.searchParams;
  if (params.get("uselibpqcompat") === "true") return null;
  const mode = params.get("sslmode")?.toLowerCase();
  if (!mode) {
    const ssl = params.get("ssl")?.toLowerCase();
    return ssl === "true" || ssl === "1" ? null : "missing";
  }
  if (mode === "verify-full") return null;
  if (mode === "prefer" || mode === "require" || mode === "verify-ca") return "legacy-alias";
  return "unverified";
}

/**
 * F-344: Vercel keeps, per deployment, the env it was built with, so an
 * Instant Rollback to a deployment built while production still pointed at
 * the old Neon database serves the live store from that database. Every
 * production build runs `prisma migrate deploy`, and Prisma prints which
 * database it migrated:
 *
 *   Datasource "db": PostgreSQL database "postgres", schema "public" at "<host>:5432"
 *
 * These helpers read that line out of `vercel inspect <deployment> --logs`
 * so scripts/check-rollback-target.mjs can refuse a target that was built
 * against anything but the current production database.
 */

/** Database hosts known to be a retired production database. */
const RETIRED_DATABASE_HOSTS = [/(^|\.)neon\.tech$/i];

/** Lower-cased hostnames from every Prisma `Datasource ... at "host:port"` line, de-duplicated. */
export function extractDatasourceHosts(buildLog) {
  const hosts = new Set();
  for (const match of String(buildLog ?? "").matchAll(/Datasource\s+"[^"\n]*":[^\n]*?\sat\s+"([^"\n]+)"/gi)) {
    const host = match[1].trim().toLowerCase().replace(/:\d+$/, "");
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/** Lower-cased hostname of a Postgres URL, or null. Never returns credentials. */
export function databaseHostFromUrl(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Decides whether a deployment's build log proves it was built against the
 * current production database. Fails closed: no `Datasource` line (a Preview
 * build never migrates, a truncated log, a CLI format change) is "unsafe",
 * because nothing proves which database that build used.
 *
 * `expectedHost` is the production database host. Without it only the known
 * retired hosts (Neon) can be rejected, and a clean result is reported with
 * `confirmed: false` so the caller can say so instead of claiming safety.
 */
export function classifyRollbackTarget(buildLog, { expectedHost } = {}) {
  const hosts = extractDatasourceHosts(buildLog);
  const expected = expectedHost ? expectedHost.toLowerCase() : null;

  if (hosts.length === 0) {
    return {
      safe: false,
      confirmed: false,
      reason: "no-datasource",
      hosts,
      message:
        "The build log has no Prisma `Datasource` line, so there is no proof of which database this " +
        "deployment was built against (a Preview build, a truncated log, or a build that skipped migrations).",
    };
  }

  const retired = hosts.filter((host) => RETIRED_DATABASE_HOSTS.some((pattern) => pattern.test(host)));
  if (retired.length > 0) {
    return {
      safe: false,
      confirmed: true,
      reason: "retired-database",
      hosts,
      message:
        `Built against a retired production database (${retired.join(", ")}). Rolling back to it would ` +
        "serve the live store from the old database: orders, customers and admin edits stored in " +
        "the current one would disappear from the store.",
    };
  }

  if (expected) {
    const others = hosts.filter((host) => host !== expected);
    if (others.length > 0) {
      return {
        safe: false,
        confirmed: true,
        reason: "wrong-database",
        hosts,
        message: `Built against ${others.join(", ")}, not the production database ${expected}.`,
      };
    }
    return {
      safe: true,
      confirmed: true,
      reason: "ok",
      hosts,
      message: `Built against the production database host ${expected}.`,
    };
  }

  return {
    safe: true,
    confirmed: false,
    reason: "unconfirmed",
    hosts,
    message:
      `Built against ${hosts.join(", ")}: not a known retired host, but no expected production database ` +
      "host was supplied to compare against.",
  };
}
