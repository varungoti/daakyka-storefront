export function shouldUseSecureSessionCookie(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) return siteUrl.startsWith("https://");
  return false;
}
