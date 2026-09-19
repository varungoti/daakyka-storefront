/**
 * Single source of truth for image hosts this app trusts — both for
 * rendering (next.config.ts's images.remotePatterns) and for anywhere
 * a request accepts an image URL and does something with it server-side
 * (the AR try-on route forwards topImageUrl/bottomImageUrl to a Python
 * service, which fetches them — an SSRF vector without a host
 * allowlist). Keeping one list means a host added for rendering is
 * automatically covered here too, and vice versa.
 *
 * Deliberately dependency-free (no "@/" imports): next.config.ts imports
 * this file directly through its own transpile-config pipeline, which
 * doesn't resolve tsconfig path aliases the way the main Next.js app
 * build does.
 */
/**
 * `daakyka.com` was removed from this list (2026-09-20): it hosted the
 * founder photos, product-design collage, and client-trust-logo images
 * that `src/data/media/catalog.ts` used to hotlink directly, but the
 * domain is unreachable from this environment (DNS resolves; every TCP
 * connect attempt times out — see the doc comment at the top of
 * catalog.ts for how that was verified). Those assets are now served
 * either as local placeholders or through the R2-backed `/cdn/...` route
 * via the image manifest (src/data/media/image-manifest.ts), so nothing
 * left in this app depends on `daakyka.com` being a trusted image host —
 * confirmed by grepping every reference to it (the only other one,
 * src/app/admin/(panel)/seo/page.tsx, uses it as plain JSON-LD example
 * text, never as an image `src` or through this allowlist). If DNS is
 * ever repointed so `daakyka.com` becomes this storefront's own
 * production domain, that's still fine without re-adding it here: this
 * list is for *remote* image hosts, and a same-origin request never
 * consults it.
 */
export const TRUSTED_IMAGE_HOSTS = [
  "images.unsplash.com",
  "images.pexels.com",
  "cdn.shopify.com",
] as const;

/**
 * The hostname of R2_PUBLIC_BASE_URL, when that env var is set to a valid
 * https:// URL — the custom domain (or r2.dev subdomain) media assets are
 * served from. Returns null when unset, invalid, or non-https so a
 * misconfigured value never silently trusts something unexpected.
 */
function r2PublicHost(): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return parsed.hostname;
}

/**
 * `TRUSTED_IMAGE_HOSTS` plus the R2 public host from env, when configured.
 * next.config.ts (remotePatterns + CSP img-src) and `isTrustedImageUrl`
 * both read from this so the R2 host is trusted everywhere at once.
 */
export function getTrustedImageHosts(): readonly string[] {
  const host = r2PublicHost();
  if (!host || (TRUSTED_IMAGE_HOSTS as readonly string[]).includes(host)) {
    return TRUSTED_IMAGE_HOSTS;
  }
  return [...TRUSTED_IMAGE_HOSTS, host];
}

export function isTrustedImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return getTrustedImageHosts().includes(parsed.hostname);
}
