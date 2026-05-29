/**
 * Curated medical scrub & institutional apparel imagery.
 * Priority: daakyka.com brand/uniform assets, then Pexels/Unsplash scrub-specific photos.
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

export function withImageWidth(url: string, width: number): string {
  if (url.includes("w=")) {
    return url.replace(/w=\d+/, `w=${width}`);
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}w=${width}`;
}

export function daakykaAsset(path: string) {
  return `https://daakyka.com/${path.replace(/^\//, "")}`;
}

/** Official brand assets from https://daakyka.com */
export const daakykaMedia = {
  logo: daakykaAsset("logo/logo.jpg"),
  /** Product design collage — scrubs, hospital linen, institutional uniforms */
  productDesigns: daakykaAsset("images/why.jpg"),
  /** Healthcare & hospital uniform manufacturing showcase */
  hospitalUniforms: daakykaAsset("images/20.jpg"),
  /** School & sports uniform production */
  schoolUniforms: daakykaAsset("images/21.jpg"),
  /** Institutional apparel & linen quality showcase */
  institutionalShowcase: daakykaAsset("images/12.jpg"),
  uniformShowcase: [
    daakykaAsset("images/why.jpg"),
    daakykaAsset("images/20.jpg"),
    daakykaAsset("images/21.jpg"),
    daakykaAsset("images/12.jpg"),
  ],
  founders: {
    kamal: daakykaAsset("owner/kamal.jpg"),
    dianeshree: daakykaAsset("owner/dianeshree.jpg"),
  },
  clientLogos: [
    { name: "KIMS Hospitals", src: daakykaAsset("images/13.jpg") },
    { name: "Pristyn Care", src: daakykaAsset("images/14.jpg") },
    { name: "RENOVA Hospitals", src: daakykaAsset("images/3.jpg") },
    { name: "Lotus Women & Children's Hospital", src: daakykaAsset("images/16.jpg") },
    { name: "Chitral Hospital", src: daakykaAsset("images/19.jpg") },
    { name: "MGM", src: daakykaAsset("images/15.jpg") },
    { name: "GAR", src: daakykaAsset("images/7.jpg") },
    { name: "ASSA ABLOY", src: daakykaAsset("images/2.jpg") },
    { name: "Phenom", src: daakykaAsset("images/9.jpg") },
    { name: "Pallavi International School", src: daakykaAsset("images/10.jpg") },
    { name: "Delhi Public School", src: daakykaAsset("images/11.jpg") },
    { name: "Meluha International School", src: daakykaAsset("images/8.jpg") },
    { name: "Oasis Public School", src: daakykaAsset("images/17.jpg") },
    { name: "Rockwell Public School", src: daakykaAsset("images/6.jpg") },
    { name: "NRIS", src: daakykaAsset("images/1.jpg") },
    { name: "Quick Smart Wash", src: daakykaAsset("images/4.jpg") },
    { name: "TOS Winflora Residency", src: daakykaAsset("images/5.jpg") },
  ],
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
  /** Healthcare worker in blue scrubs with ID badge */
  clinicalBlue: pexelsPhoto(5712513),
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
  bespokeFeature: daakykaMedia.hospitalUniforms,
  insightsFabric: scrubMedia.mandarinSage,
  insightsInstitutional: daakykaMedia.institutionalShowcase,
  shopFeatureFabric: scrubMedia.zipLilac,
  shopFeatureBespoke: daakykaMedia.schoolUniforms,
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
