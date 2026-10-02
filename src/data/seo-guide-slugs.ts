/**
 * F-052: the slug of every SEO guide served at /guides/<slug>, kept apart from
 * the guides' full copy (src/data/seo-landing-pages.ts, ~35 KB) so the admin
 * SEO override form — a Client Component — can list `/guides/<slug>` as
 * overridable paths (src/lib/seo/wired-paths.ts) without bundling every
 * guide's body text into the browser. src/data/seo-landing-pages.test.ts
 * fails if this list and `seoLandingPages` ever drift apart.
 */
export const SEO_GUIDE_SLUGS = [
  "hospital-uniforms",
  "scrubs-for-men",
  "scrubs-for-women",
  "nurse-uniforms",
  "medical-scrubs",
  "custom-embroidered-scrubs",
  "best-scrubs-for-long-shifts",
  "doctor-scrubs",
  "scrub-tops",
  "scrub-pants",
  "jogger-scrub-pants",
  "mandarin-collar-scrubs",
  "bulk-hospital-uniforms",
  "best-scrubs-for-doctors",
  "best-scrubs-for-nurses",
  "how-to-find-scrub-size",
  "how-to-choose-medical-scrubs",
  "how-to-wash-medical-scrubs",
  "scrubs-vs-lab-coat",
  "best-colors-for-hospital-uniforms",
  "what-is-4-way-stretch-fabric",
] as const;
