import type { MediaUsage } from "@/generated/prisma/client";
import type { AspectRatio, PromptFields, PromptPreset } from "@/lib/ai/prompt-presets";

/**
 * Phase E2: the single source of truth for every non-product site image
 * slot — hero banners, homepage tiles, feature bands, content-page
 * heroes, and the size-guide illustration. Each entry names a stable
 * `MediaAsset.slot` and the AI generation preset/aspect/fields an admin
 * would use to (re)generate it from `/admin/media` (the "Site Images"
 * tab, see src/components/admin/site-images-grid.tsx).
 *
 * Reading a slot's current image is `getSiteImage(slot)`
 * (src/lib/media/get-site-image.ts) — it returns `null` when nothing has
 * been generated/uploaded yet (the only state reachable in an environment
 * with no OPENAI_API_KEY/R2 credentials), and callers fall back to a
 * neutral placeholder SVG. Nothing in this file does I/O.
 *
 * Deliberately NOT included here (per the plan, E2 scope): the 404 image,
 * the OG image, favicon/manifest icons, and the logo mark (the logo is
 * explicitly text-based/brand-exact, never AI-generated). OG/favicon are
 * static brand assets better handled as a later SEO-assets task.
 */

/**
 * Aspect ratios the manifest can describe — a superset of `AspectRatio`
 * (src/lib/ai/prompt-presets.ts), which is all the OpenAI image API
 * itself supports via `sizeForAspect`. `"wide"` is display-only, for
 * ultra-wide hero/banner slots; there's no wider size in the image API,
 * so `toGenerationAspect` maps it down to `"landscape"` (the widest size
 * available) whenever a manifest entry is actually sent to
 * `generateImage` / `POST /api/admin/media/generate`.
 */
export type ManifestAspect = AspectRatio | "wide";

export function toGenerationAspect(aspect: ManifestAspect): AspectRatio {
  return aspect === "wide" ? "landscape" : aspect;
}

/** Tailwind arbitrary aspect-ratio class for a manifest aspect — used by
 * the admin Site Images grid so each slot preview roughly matches how it
 * will actually be cropped on the storefront. */
export function aspectClassName(aspect: ManifestAspect): string {
  switch (aspect) {
    case "square":
      return "aspect-square";
    case "portrait":
      return "aspect-[4/5]";
    case "landscape":
      return "aspect-[4/3]";
    case "wide":
      return "aspect-[21/9]";
  }
}

/**
 * The neutral placeholder (under `public/`) that best matches a given
 * aspect without obvious letterboxing under `object-cover`. Square and
 * portrait slots reuse the existing product placeholder (already a 4:5
 * garment icon on light grey); landscape and wide slots get their own
 * placeholders (C4/C5's placeholder-product.svg is too narrow/tall for
 * either).
 */
export function placeholderForAspect(aspect: ManifestAspect): string {
  switch (aspect) {
    case "square":
    case "portrait":
      return "/placeholder-product.svg";
    case "landscape":
      return "/placeholder-scene.svg";
    case "wide":
      return "/placeholder-banner.svg";
  }
}

export interface ImageManifestEntry {
  /** Stable key stored on `MediaAsset.slot` (unique). */
  slot: string;
  usage: MediaUsage;
  preset: PromptPreset;
  aspect: ManifestAspect;
  /** Human-readable label for the admin Site Images list. */
  label: string;
  /** Preset-specific hint fields, pre-filling the AI generation prompt. */
  fields?: PromptFields;
  /**
   * True when this slot depicts a real, specific person or a real
   * third-party's trademark (founder portraits, a named client's logo) —
   * never a generic/anonymized scene. `preset` is still required for type
   * simplicity but is inert for these slots: `isUploadOnlySlot()` blocks
   * `generateImage()` server-side regardless of what a client sends, and
   * the admin Site Images grid (`SiteImagesGrid`) hides the "Generate with
   * AI" action for them. Upload is the only way to set these.
   */
  uploadOnly?: boolean;
}

/**
 * Real institutional clients shown in the About page "Trusted by" strip
 * (src/components/brand/client-logos-strip.tsx). A fixed, code-defined
 * list — not admin-managed DB data — so these get static manifest slots
 * (like `home.tile.*`) instead of the dynamic `category.{slug}` pattern,
 * which is reserved for genuinely variable-length admin-managed lists.
 * Every one of these is a real company's trademark, so the corresponding
 * `about.client.*` manifest entries below are all `uploadOnly`. Slugs are
 * spelled out explicitly (not derived at runtime) so they're stable and
 * reviewable in a diff.
 */
export const ABOUT_CLIENT_LOGOS: readonly { name: string; slot: string }[] = [
  { name: "KIMS Hospitals", slot: "about.client.kims-hospitals" },
  { name: "Pristyn Care", slot: "about.client.pristyn-care" },
  { name: "RENOVA Hospitals", slot: "about.client.renova-hospitals" },
  { name: "Lotus Women & Children's Hospital", slot: "about.client.lotus-womens-hospital" },
  { name: "Chitral Hospital", slot: "about.client.chitral-hospital" },
  { name: "MGM", slot: "about.client.mgm" },
  { name: "GAR", slot: "about.client.gar" },
  { name: "ASSA ABLOY", slot: "about.client.assa-abloy" },
  { name: "Phenom", slot: "about.client.phenom" },
  { name: "Pallavi International School", slot: "about.client.pallavi-international-school" },
  { name: "Delhi Public School", slot: "about.client.delhi-public-school" },
  { name: "Meluha International School", slot: "about.client.meluha-international-school" },
  { name: "Oasis Public School", slot: "about.client.oasis-public-school" },
  { name: "Rockwell Public School", slot: "about.client.rockwell-public-school" },
  { name: "NRIS", slot: "about.client.nris" },
  { name: "Quick Smart Wash", slot: "about.client.quick-smart-wash" },
  { name: "TOS Winflora Residency", slot: "about.client.tos-winflora-residency" },
] as const;

export const IMAGE_MANIFEST: ImageManifestEntry[] = [
  // --- Home hero (carousel slots; the current hero shows two of these
  // side by side — see src/components/home/hero-section.tsx) ---
  {
    slot: "home.hero.1",
    usage: "BANNER",
    preset: "hero-banner",
    aspect: "wide",
    label: "Homepage Hero — Slide 1",
    fields: {
      subject:
        "a healthcare professional confidently wearing a clean DAAKYKA scrub set, warm and approachable",
    },
  },
  {
    slot: "home.hero.2",
    usage: "BANNER",
    preset: "hero-banner",
    aspect: "wide",
    label: "Homepage Hero — Slide 2",
    fields: {
      subject: "hospital staff in coordinated DAAKYKA scrub sets in a bright, modern clinic setting",
    },
  },
  {
    slot: "home.hero.3",
    usage: "BANNER",
    preset: "hero-banner",
    aspect: "wide",
    label: "Homepage Hero — Slide 3",
    fields: {
      subject: "school students in smart DAAKYKA uniforms on a sunny campus courtyard",
    },
  },

  // --- Homepage "shop by category" tiles ---
  {
    slot: "home.tile.for-hospitals",
    usage: "SECTION",
    preset: "category-tile",
    aspect: "portrait",
    label: "Homepage Tile — For Hospitals",
    fields: { name: "For Hospitals", category: "hospital scrubs, gowns and linens" },
  },
  {
    slot: "home.tile.school-uniforms",
    usage: "SECTION",
    preset: "category-tile",
    aspect: "portrait",
    label: "Homepage Tile — School Uniforms",
    fields: { name: "School Uniforms", category: "school shirts, tunics and blazers" },
  },
  {
    slot: "home.tile.kids-wear",
    usage: "SECTION",
    preset: "category-tile",
    aspect: "portrait",
    label: "Homepage Tile — Kids Wear",
    fields: { name: "Kids Wear", category: "everyday kids clothing" },
  },
  {
    slot: "home.tile.sale",
    usage: "SECTION",
    preset: "category-tile",
    aspect: "portrait",
    label: "Homepage Tile — Sale",
    fields: { name: "Sale", category: "discounted apparel" },
  },

  // --- Homepage feature bands ---
  {
    slot: "home.band.hospital",
    usage: "SECTION",
    preset: "hospital-scene",
    aspect: "landscape",
    label: "Homepage Band — For Hospitals",
  },
  {
    slot: "home.band.school",
    usage: "SECTION",
    preset: "school-scene",
    aspect: "landscape",
    label: "Homepage Band — School Uniforms",
  },

  // --- Content-page heroes/banners ---
  {
    slot: "our-story.hero",
    usage: "BANNER",
    preset: "hero-banner",
    aspect: "wide",
    label: "Our Story — Hero",
    fields: {
      subject: "the DAAKYKA founders' craft — fabric, stitching, and uniform design in a bright studio",
    },
  },
  {
    slot: "about.hero",
    usage: "BANNER",
    preset: "hero-banner",
    aspect: "wide",
    label: "About — Hero",
    fields: {
      subject: "a coordinated group wearing DAAKYKA hospital, school, and kids apparel together",
    },
  },
  // --- About page trust assets — real people and real clients' logos,
  // never AI-generatable (see `uploadOnly` on ImageManifestEntry above and
  // `isUploadOnlySlot` below). These were previously hotlinked directly to
  // https://daakyka.com/owner/*.jpg and /images/*.jpg — that domain is
  // unreachable from this environment (DNS resolves; every TCP connect
  // times out on every resolved IP, both ports 80/443, confirmed via curl
  // and an independent .NET/PowerShell stack) — so the about page now
  // reads these through the same admin-upload path as every other slot,
  // falling back to a text-only treatment (no image element at all) until
  // an admin uploads the real photo/logo. `preset`/`fields` are present
  // only for type-shape consistency and are never actually sent to the
  // generation API for an `uploadOnly` slot.
  {
    slot: "about.founder.kamal",
    usage: "AVATAR",
    preset: "avatar",
    aspect: "portrait",
    label: "About — Founder Portrait: Kamal Agarwal",
    uploadOnly: true,
  },
  {
    slot: "about.founder.dianeshree",
    usage: "AVATAR",
    preset: "avatar",
    aspect: "portrait",
    label: "About — Founder Portrait: Dianeshree Agarwal",
    uploadOnly: true,
  },
  {
    slot: "about.process",
    usage: "SECTION",
    preset: "hero-banner",
    aspect: "landscape",
    label: "About — Our Process (Concept to Delivery)",
    uploadOnly: true,
  },
  ...ABOUT_CLIENT_LOGOS.map(
    ({ name, slot }): ImageManifestEntry => ({
      slot,
      usage: "SECTION",
      preset: "category-tile",
      aspect: "square",
      label: `About — Client Logo: ${name}`,
      uploadOnly: true,
    }),
  ),
  {
    slot: "bulk-orders.hero",
    usage: "BANNER",
    preset: "hospital-scene",
    aspect: "landscape",
    label: "Bulk Orders — Hero",
    fields: {
      subject: "a hospital team in matching DAAKYKA scrub sets, representing a bulk institutional order",
    },
  },
  {
    slot: "contact.banner",
    usage: "BANNER",
    preset: "hero-banner",
    aspect: "wide",
    label: "Contact — Banner",
    fields: { subject: "a warm, welcoming customer-service setting" },
  },

  // --- Size guide ---
  {
    slot: "size-guide.how-to-measure",
    usage: "SECTION",
    preset: "how-to-measure",
    aspect: "portrait",
    label: "Size Guide — How to Measure",
  },
];

const slotSet = new Set(IMAGE_MANIFEST.map((entry) => entry.slot));

export function isManifestSlot(slot: string): boolean {
  return slotSet.has(slot);
}

const uploadOnlySlotSet = new Set(
  IMAGE_MANIFEST.filter((entry) => entry.uploadOnly).map((entry) => entry.slot),
);

/**
 * True for a static manifest slot marked `uploadOnly` (real people / real
 * trademarks — see `ImageManifestEntry.uploadOnly`). `generateImage()`
 * (src/lib/ai/image-generation.ts) calls this to refuse AI generation for
 * these slots server-side, regardless of what a client request asks for.
 * Always false for an unrecognized or dynamic (`category.*`/`blog.post.*`)
 * slot, and false when no slot is given at all (e.g. a per-product
 * generation call) — both of those are fine to generate.
 */
export function isUploadOnlySlot(slot: string | undefined): boolean {
  return slot !== undefined && uploadOnlySlotSet.has(slot);
}

/** Returns every slot string that appears more than once in `entries`
 * (defaults to the real manifest) — used by the unit test and safe to
 * call on any candidate list. */
export function findDuplicateSlots(entries: ImageManifestEntry[] = IMAGE_MANIFEST): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.slot)) dupes.add(entry.slot);
    seen.add(entry.slot);
  }
  return [...dupes];
}

// ---------------------------------------------------------------------------
// Dynamic slots — generated at read time from live data, never hardcoded.
// ---------------------------------------------------------------------------

/**
 * Every active `Category` gets a `category.{slug}` slot (category-tile
 * preset). Generated from `getCategoryTree()` at call sites (the admin
 * Site Images list, and the section-landing pages), not enumerated here,
 * since categories are admin-managed data.
 */
export function categoryImageSlot(category: { slug: string; name: string }): ImageManifestEntry {
  return {
    slot: `category.${category.slug}`,
    usage: "CATEGORY",
    preset: "category-tile",
    aspect: "portrait",
    label: `Category — ${category.name}`,
    fields: { name: category.name, category: category.name },
  };
}

/**
 * Every `BlogPostRecord` gets a `blog.post.{slug}` slot (blog preset)
 * instead of a fixed `blog.cover.1/2/3` list — `BlogPostRecord` is
 * already keyed by slug and the catalog can grow past 3 posts, so a
 * dynamic per-post slot (mirroring `category.{slug}`) fits the actual
 * data model better than a hardcoded count.
 */
export function blogPostImageSlot(post: { slug: string; title: string }): ImageManifestEntry {
  return {
    slot: `blog.post.${post.slug}`,
    usage: "BLOG",
    preset: "blog",
    aspect: "landscape",
    label: `Blog Cover — ${post.title}`,
    fields: { subject: post.title },
  };
}
