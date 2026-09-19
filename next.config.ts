import type { NextConfig } from "next";
import { fabricSeoRedirects, seoLandingPages } from "./src/data/seo-landing-pages";
import { isProduction, validateEnv } from "./src/lib/env";
import { getTrustedImageHosts } from "./src/lib/security/image-hosts";

validateEnv();

// A pragmatic CSP, not the fully strict nonce-based one: this app
// relies on inline style="" attributes throughout (dynamic tint
// colors, etc.) and next/font injects an inline <style> block for
// @font-face rules, so style-src needs 'unsafe-inline'. script-src
// also allows 'unsafe-inline' rather than a per-request nonce, since
// Next's App Router streams inline hydration scripts
// (self.__next_f.push(...)) that a strict nonce-based CSP would need
// threaded through proxy.ts on every route (not just /admin) to avoid
// breaking hydration — a larger, riskier change tracked separately.
// This still blocks the most common injection payloads: loading a
// remote <script src="https://evil.example">, framing the site
// (frame-ancestors, redundant with X-Frame-Options for older
// browsers), <object>/<embed>, and form submissions to another origin.
const trustedImageHosts = getTrustedImageHosts();
const imageSources = trustedImageHosts.map((host) => `https://${host}`).join(" ");
const contentSecurityPolicy = [
  "default-src 'self'",
  // Phase D3: Razorpay Checkout.js is loaded from the client (see
  // src/lib/payments/load-razorpay-script.ts) and needs to run its own
  // script and open its payment modal, which embeds an iframe served
  // from api.razorpay.com and posts back to it over fetch/XHR.
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageSources}`,
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

// F6 fix: was gated on `VERCEL_ENV === "production"`, so a non-Vercel
// production deploy (e.g. a Docker/VM self-host running `next start`)
// silently shipped without HSTS. isProduction() (NODE_ENV === "production",
// already used the same way in src/lib/auth/session-cookie.ts for the
// Secure-cookie decision) covers that deploy too. `next build` always
// forces NODE_ENV=production regardless of host, so this also now applies
// to Vercel preview builds in addition to production ones — both are
// real HTTPS-served origins, so that's a strictly safe broadening, not a
// weakening, of the existing header.
if (isProduction()) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  images: {
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: trustedImageHosts.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
  },
  async redirects() {
    return [
      // Phase C3: /hospital-uniforms and /institutional now point at the
      // real /for-hospitals section landing page instead of their old
      // destinations (a guide page, and a standalone page respectively —
      // both removed). The "hospital-uniforms" SEO landing page config
      // still exists and still renders at /guides/hospital-uniforms; it's
      // excluded here so its own path-based redirect below doesn't
      // conflict with this one.
      { source: "/hospital-uniforms", destination: "/for-hospitals", permanent: true },
      { source: "/institutional", destination: "/for-hospitals", permanent: true },
      ...seoLandingPages
        .filter((page) => page.slug !== "hospital-uniforms")
        .map((page) => ({
          source: page.path,
          destination: `/guides/${page.slug}`,
          permanent: true,
        })),
      ...fabricSeoRedirects.map((redirect) => ({
        source: redirect.path,
        destination: redirect.destination,
        permanent: true,
      })),
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
