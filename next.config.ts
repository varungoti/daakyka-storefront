import type { NextConfig } from "next";
import { fabricSeoRedirects, seoLandingPages } from "./src/data/seo-landing-pages";
import { validateEnv } from "./src/lib/env";
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
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageSources}`,
  "font-src 'self' data:",
  "connect-src 'self'",
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

if (process.env.VERCEL_ENV === "production") {
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
