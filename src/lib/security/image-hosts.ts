/**
 * Single source of truth for image hosts this app trusts — both for
 * rendering (next.config.ts's images.remotePatterns) and for anywhere
 * a request accepts an image URL and does something with it server-side
 * (the AR try-on route forwards topImageUrl/bottomImageUrl to a Python
 * service, which fetches them — an SSRF vector without a host
 * allowlist). Keeping one list means a host added for rendering is
 * automatically covered here too, and vice versa.
 */
export const TRUSTED_IMAGE_HOSTS = [
  "images.unsplash.com",
  "images.pexels.com",
  "daakyka.com",
  "cdn.shopify.com",
] as const;

export function isTrustedImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return (TRUSTED_IMAGE_HOSTS as readonly string[]).includes(parsed.hostname);
}
