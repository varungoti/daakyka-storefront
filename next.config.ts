import type { NextConfig } from "next";
import { fabricSeoRedirects, seoLandingPages } from "./src/data/seo-landing-pages";
import { validateEnv } from "./src/lib/env";
import { TRUSTED_IMAGE_HOSTS } from "./src/lib/security/image-hosts";

validateEnv();

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
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
    remotePatterns: TRUSTED_IMAGE_HOSTS.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
  },
  async redirects() {
    return [
      ...seoLandingPages.map((page) => ({
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
