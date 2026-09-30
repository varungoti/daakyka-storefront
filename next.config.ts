import type { NextConfig } from "next";
import { fabricSeoRedirects, seoLandingPages } from "./src/data/seo-landing-pages";
import { isProduction, validateEnv } from "./src/lib/env";
import { getTrustedImageHosts } from "./src/lib/security/image-hosts";

validateEnv();

// release-hardening F-156: fabricSeoRedirects' own `destination` values
// point at /fabric-technology/<slug> detail pages, which 404 while Fabric
// Technology stays disabled behind the `fabricTech` Site Controls flag
// (src/app/fabric-technology/[slug]/page.tsx calls notFound() when it's
// off) — permanently redirecting a legacy SEO URL straight into a 404
// wastes whatever link equity it had. `redirects()` below is resolved once
// (build/startup), so it can't read that runtime, DB-backed flag to decide
// conditionally; instead, send these legacy URLs to a page that's live
// either way — the matching /guides article when one exists, /shop
// otherwise — regardless of the flag.
const FABRIC_SEO_FALLBACK_DESTINATIONS: Record<string, string> = {
  "/4-way-stretch-scrubs": "/guides/what-is-4-way-stretch-fabric",
};

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
  // F-119 fix: checkout.js itself pulls in a second script,
  // cdn.razorpay.com/static/cx/razorpay-risk-detection/bundle.js, and
  // beacons telemetry to lumberjack.razorpay.com — both were still being
  // refused by this CSP, which silently disabled Razorpay's own
  // fraud/risk scoring on every checkout (payment still worked; the
  // console just filled with CSP refusals). cdn.razorpay.com is also
  // allowed in img-src since Razorpay serves some bank/UPI app logos
  // from there.
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://cdn.razorpay.com ${imageSources}`,
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
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
  // Dynamic SEO records must be present in <head> for browser audits and
  // HTML-only consumers as well as JavaScript-capable crawlers. This trades
  // some initial response latency for consistent metadata placement.
  htmlLimitedBots: /.*/,
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
      // release-hardening audit F-020: these three /collections/<handle>
      // pages used to render nothing but a "Continue to X" interstitial
      // with zero products (see the removed entries in
      // src/data/seo-landing-pages.ts's collectionPages) — redirect
      // straight to their real destinations instead of a dead middle page.
      { source: "/collections/hospital-teams", destination: "/for-hospitals", permanent: true },
      { source: "/collections/stretch-collection", destination: "/shop", permanent: true },
      { source: "/collections/bespoke", destination: "/shop", permanent: true },
      ...seoLandingPages
        .filter((page) => page.slug !== "hospital-uniforms")
        .map((page) => ({
          source: page.path,
          destination: `/guides/${page.slug}`,
          permanent: true,
        })),
      ...fabricSeoRedirects.map((redirect) => ({
        source: redirect.path,
        destination: FABRIC_SEO_FALLBACK_DESTINATIONS[redirect.path] ?? "/shop",
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
