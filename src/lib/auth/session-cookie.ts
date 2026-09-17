import { isProduction, isVercel } from "@/lib/env";

export function shouldUseSecureSessionCookie(): boolean {
  // Production and Vercel (preview or production) always get a Secure
  // cookie, full stop — COOKIE_SECURE=false must not be able to turn it
  // off there. That override existing at all meant a production deploy
  // missing NEXT_PUBLIC_SITE_URL, or one where it was accidentally set
  // to an http:// value, silently shipped a non-Secure session cookie.
  if (isProduction() || isVercel()) return true;

  if (process.env.COOKIE_SECURE === "false") return false;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) return siteUrl.startsWith("https://");
  return false;
}
