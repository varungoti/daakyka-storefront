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
