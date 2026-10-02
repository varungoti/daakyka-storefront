import type { Metadata } from "next";

/**
 * release-hardening F-320: the root layout's `verification` metadata, so the
 * owner can verify the storefront in Google Search Console and Meta Business
 * Suite with a meta tag — no code change, just an env var — instead of a
 * DNS TXT record at Hostinger (still the simpler route once daakyka.com
 * points at Vercel; a *.vercel.app host can't take a DNS record at all).
 * Unset (the default) means Next omits the tag entirely.
 *
 * - `GOOGLE_SITE_VERIFICATION`: the `content` of Search Console's
 *   "HTML tag" method (<meta name="google-site-verification" ...>).
 * - `FB_DOMAIN_VERIFICATION`: the `content` of Meta's domain-verification
 *   meta tag (<meta name="facebook-domain-verification" ...>).
 *
 * Read through a function (not a module constant) so it picks up the value
 * each request/test sets rather than whatever was in the env at import time.
 */
export function siteVerification(
  env: Record<string, string | undefined> = process.env,
): NonNullable<Metadata["verification"]> {
  return {
    google: env.GOOGLE_SITE_VERIFICATION || undefined,
    other: env.FB_DOMAIN_VERIFICATION
      ? { "facebook-domain-verification": env.FB_DOMAIN_VERIFICATION }
      : undefined,
  };
}
