/**
 * Curated medical scrub & institutional apparel imagery.
 *
 * Generic scene/product photography below (`daakykaMedia.hospitalUniforms`,
 * `.schoolUniforms`, `.institutionalShowcase`, `.productDesigns`) used to
 * hotlink directly to https://daakyka.com/images/*.jpg. That domain is
 * unreachable from this environment — DNS resolves to several IPv4
 * addresses, but every TCP connect attempt times out on every one of them,
 * on both port 80 and 443, confirmed independently via curl and a
 * .NET/PowerShell socket test (ruling out a client-specific quirk like the
 * documented R2 TLS issue in src/lib/storage/r2.ts, where the TCP/TLS
 * handshake itself succeeds). These fields pointed at a local placeholder
 * SVG for a while so nothing site-wide rendered a broken image box, but a
 * placeholder graphic on a live shopper-facing page is its own bug
 * (release-hardening audit F-272 — see daakykaMedia's own doc comment
 * below) — they now point at real, licensed Pexels/Unsplash photography
 * like the rest of this file.
 *
 * Founder portraits and real client logos are NOT here — real people and
 * real trademarks must never be a hardcoded hotlink (or an AI-generated
 * substitute). They're admin-managed via the image manifest instead — see
 * `about.founder.*` / `about.client.*` in src/data/media/image-manifest.ts,
 * read through `getSiteImage`/`getSiteImages` from src/app/about/page.tsx
 * and src/components/brand/client-logos-strip.tsx.
 */

/** Tuned widths for Lighthouse — cards ~560, PDP gallery ~800, hero ~960 */
export const imageWidths = {
  card: 560,
  gallery: 800,
  hero: 960,
  feature: 720,
  avatar: 160,
} as const;

export function pexelsPhoto(id: number, width: number = imageWidths.card) {
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}&fit=crop`;
}

export function unsplashPhoto(path: string, width: number = imageWidths.card) {
  return `https://images.unsplash.com/${path}?auto=format&fit=crop&w=${width}&q=80`;
}

/**
 * Appends/replaces a `?w=` resize hint — the convention Pexels/Unsplash
 * both accept on their CDN URLs. A no-op for a local/same-origin path
 * (`/placeholder-*.svg` etc.): those aren't served by a resizing CDN, and
 * next/image resolves its own `_next/image?url=...&w=...` for local
 * assets, so appending a stray `?w=` here would just become part of the
 * literal (and wrong) filename it looks up.
 */
export function withImageWidth(url: string, width: number): string {
  if (url.startsWith("/")) return url;
  if (url.includes("w=")) {
    return url.replace(/w=\d+/, `w=${width}`);
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}w=${width}`;
}

/**
 * Generic uniform/manufacturing scene photography — NOT real, identifiable
 * people or trademarks (contrast with the founder portraits and client
 * logos, which are admin-managed via the image manifest; see the file
 * doc comment above).
 *
 * release-hardening audit F-272: these four fields used to all point at
 * `/placeholder-scene.svg` — a large grey image-icon shown to every
 * shopper on /shop/bespoke, /our-story and /shop (see bespoke-section.tsx
 * and shop-feature-cards.tsx). None of them are declared slots in
 * src/data/media/image-manifest.ts, so there was also no way for an admin
 * to ever replace them from Site Images. The bespoke enquiry now uses an
 * explicitly illustrative tailoring scene. Other generic scenes still
 * use the licensed Pexels/Unsplash photography elsewhere in this file.
 */
export const daakykaMedia = {
  /** Product design collage — scrubs, hospital linen, institutional uniforms */
  productDesigns: pexelsPhoto(8460109, imageWidths.feature),
  /** Illustrative hospital apparel and linen design studio */
  hospitalUniforms: "/images/hospital-apparel-studio.webp",
  /** School & sports uniform production */
  schoolUniforms: pexelsPhoto(4386466, imageWidths.hero),
  /** Institutional apparel & linen quality showcase */
  institutionalShowcase: pexelsPhoto(4173251, imageWidths.feature),
} as const;

/** People wearing medical scrubs / scrub suits — verified stock IDs */
export const scrubMedia = {
  /** Lilac / purple V-neck scrub top (Unsplash — verified clinical scrubs) */
  vNeckLilac: unsplashPhoto("photo-1666887360684-8082fc98ebd2"),
  /** Navy blue scrub suit — nurse with patient */
  joggerNavy: pexelsPhoto(6129685),
  /** Sage green scrub top — clinical wear */
  mandarinSage: pexelsPhoto(4386466),
  /** Charcoal gray full scrub suit with stethoscope */
  straightCharcoal: pexelsPhoto(5327656),
  /** White round-neck scrub top */
  roundWhite: pexelsPhoto(6129115),
  /** Teal cargo-style scrub pants */
  cargoTeal: pexelsPhoto(7173276),
  /** Lilac zip-neck modern scrub top */
  zipLilac: pexelsPhoto(7579831),
  /** Hospital team in coordinated scrub uniforms */
  bespokePlum: pexelsPhoto(4021775),
  /** Full-body medical scrubs — Unsplash */
  scrubsFullBody: unsplashPhoto("photo-1666887360684-8082fc98ebd2"),
  /** Nurse in scrubs — clinical portrait */
  nursePortrait: pexelsPhoto(4173251),
  /** Navy-clad healthcare worker in a clinical setting */
  clinicalBlue: pexelsPhoto(6129685),
  /** Surgeon / OR scrubs preparation */
  orScrubs: pexelsPhoto(8460109),
} as const;

/** Homepage & marketing — daakyka brand first, scrubs for product context */
export const marketingMedia = {
  /** Dual-model hero — healthcare professionals in scrubs */
  heroMain: pexelsPhoto(4173251, imageWidths.hero),
  heroSecondary: pexelsPhoto(5327656, imageWidths.hero),
  heroAvatars: [
    pexelsPhoto(5327656, imageWidths.avatar),
    pexelsPhoto(6129685, imageWidths.avatar),
    pexelsPhoto(6129115, imageWidths.avatar),
    pexelsPhoto(7579831, imageWidths.avatar),
  ],
  mixMatchTops: [scrubMedia.zipLilac, scrubMedia.joggerNavy, scrubMedia.vNeckLilac, scrubMedia.mandarinSage],
  mixMatchDefault: scrubMedia.straightCharcoal,
  bespokeFeature: "/images/bespoke-worktable.webp",
  insightsFabric: scrubMedia.mandarinSage,
  insightsInstitutional: daakykaMedia.institutionalShowcase,
  shopFeatureFabric: scrubMedia.zipLilac,
  shopFeatureBespoke: "/images/bespoke-worktable.webp",
  bulkOrdersHero: daakykaMedia.hospitalUniforms,
  aboutProcess: daakykaMedia.productDesigns,
} as const;

/** Shop category tiles */
export const categoryMedia = {
  tops: scrubMedia.vNeckLilac,
  bottoms: scrubMedia.joggerNavy,
  sets: scrubMedia.clinicalBlue,
  jackets: scrubMedia.mandarinSage,
  accessories: scrubMedia.straightCharcoal,
  bespoke: daakykaMedia.hospitalUniforms,
} as const;

/** Blog hero images */
export const blogMedia = {
  chooseScrubs: scrubMedia.nursePortrait,
  hospitalColors: scrubMedia.vNeckLilac,
  careScrubs: scrubMedia.roundWhite,
  institutionalLinens: daakykaMedia.hospitalUniforms,
} as const;

/** Testimonial avatars — healthcare workers in scrubs */
export const testimonialAvatars = {
  amanda: pexelsPhoto(5327656, imageWidths.avatar),
  priya: pexelsPhoto(6129685, imageWidths.avatar),
  marcus: pexelsPhoto(6129115, imageWidths.avatar),
  sarah: pexelsPhoto(7579831, imageWidths.avatar),
} as const;

const productImageByHandle: Record<string, string> = {
  "v-neck-top-lilac": scrubMedia.vNeckLilac,
  "jogger-pants-navy": scrubMedia.joggerNavy,
  "mandarin-collar-sage": scrubMedia.mandarinSage,
  "straight-pants-charcoal": scrubMedia.straightCharcoal,
  "round-neck-white": scrubMedia.roundWhite,
  "cargo-pants-teal": scrubMedia.cargoTeal,
  "zip-neck-lilac": scrubMedia.zipLilac,
  "bespoke-plum-set": scrubMedia.bespokePlum,
};

export function productImage(handle: string): string {
  return productImageByHandle[handle] ?? scrubMedia.scrubsFullBody;
}

const productGalleryByHandle: Record<string, string[]> = {
  "v-neck-top-lilac": [scrubMedia.vNeckLilac, scrubMedia.zipLilac, daakykaMedia.productDesigns],
  "jogger-pants-navy": [scrubMedia.joggerNavy, scrubMedia.straightCharcoal, scrubMedia.cargoTeal],
  "mandarin-collar-sage": [scrubMedia.mandarinSage, scrubMedia.vNeckLilac, scrubMedia.roundWhite],
  "straight-pants-charcoal": [scrubMedia.straightCharcoal, scrubMedia.joggerNavy, scrubMedia.cargoTeal],
  "round-neck-white": [scrubMedia.roundWhite, scrubMedia.vNeckLilac, scrubMedia.mandarinSage],
  "cargo-pants-teal": [scrubMedia.cargoTeal, scrubMedia.joggerNavy, scrubMedia.straightCharcoal],
  "zip-neck-lilac": [scrubMedia.zipLilac, scrubMedia.vNeckLilac, daakykaMedia.hospitalUniforms],
  "bespoke-plum-set": [scrubMedia.bespokePlum, daakykaMedia.productDesigns, daakykaMedia.hospitalUniforms],
};

export function productGallery(handle: string): string[] {
  const images = productGalleryByHandle[handle] ?? [productImage(handle)];
  return images.map((url) => withImageWidth(url, imageWidths.gallery));
}

export const defaultCartLineImage = scrubMedia.vNeckLilac;

/** Preset try-on avatars (OutfitAnyone / studio — no user photo upload in v1) */
export const tryOnAvatars = {
  male: pexelsPhoto(5327656, imageWidths.gallery),
  female: pexelsPhoto(4173251, imageWidths.gallery),
} as const;

/** Full-body models for homepage mix-and-match visualizer */
export const mixMatchModels = {
  female: pexelsPhoto(4173251, imageWidths.hero),
  male: pexelsPhoto(5327656, imageWidths.hero),
} as const;
