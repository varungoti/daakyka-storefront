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
export const TRUSTED_IMAGE_HOSTS = [
  "images.unsplash.com",
  "images.pexels.com",
  "daakyka.com",
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
