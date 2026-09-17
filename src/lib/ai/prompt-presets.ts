/**
 * Prompt building for AI-generated site imagery. Kept dependency-free
 * (pure string building, no I/O) so it's trivially unit-testable and safe
 * to import from anywhere without pulling in the OpenAI client or Prisma.
 */

export type PromptPreset =
  | "product"
  | "category-tile"
  | "hero-banner"
  | "hospital-scene"
  | "school-scene"
  | "kids-scene"
  | "blog"
  | "avatar"
  | "how-to-measure";

export type AspectRatio = "square" | "portrait" | "landscape";

/** The size strings the GPT image models accept for a plain aspect choice. */
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export function sizeForAspect(aspect: AspectRatio): ImageSize {
  switch (aspect) {
    case "square":
      return "1024x1024";
    case "portrait":
      return "1024x1536";
    case "landscape":
      return "1536x1024";
  }
}

export interface PromptFields {
  /** Product/section/subject name, e.g. "Unisex Scrub Set". */
  name?: string;
  color?: string;
  category?: string;
  gender?: string;
  fabric?: string;
  /** Free-form description of who/what should appear in a scene preset. */
  subject?: string;
  /** Extra free-text detail appended verbatim (still passed through the style guide). */
  notes?: string;
}

// Shared style language so every generated image looks like it belongs on
// the same site, regardless of preset.
const STYLE_GUIDE =
  "Clean, bright, light neutral studio or softly lit real-world setting; natural, photorealistic photography with true-to-life color and soft even lighting; no text, no logos, no watermarks, no visible brand marks.";

const BRAND_CONTEXT =
  "For DAAKYKA Apparels, a Hyderabad-based maker of medical scrubs and hospital linens, school uniforms, and kids wear. The brand colours — plum (#8a347d), deep purple (#5d00a3), and accent yellow (#ffcc00) — may appear subtly in garments or props only where it looks natural for the scene; never as overlays, banners, or printed text.";

// Kids and school presets must never produce identifiable depictions of
// real children — generic, age-appropriate, and non-identifiable only.
const KIDS_SAFETY_GUIDE =
  "Depict only generic, non-identifiable children: no recognizable faces, no close-up portraits, medium or wide shots only, age-appropriate and fully modest clothing, cheerful and wholesome tone.";

function join(...parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim().length > 0)).join(" ");
}

function fallback(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : defaultValue;
}

export function buildPrompt(preset: PromptPreset, fields: PromptFields = {}): string {
  const name = fallback(fields.name, "a garment");
  const color = fallback(fields.color, "a neutral colour true to the product");
  const category = fallback(fields.category, "apparel");
  const gender = fallback(fields.gender, "unisex");
  const fabric = fields.fabric?.trim();
  const subject = fields.subject?.trim();
  const notes = fields.notes?.trim();

  switch (preset) {
    case "product":
      return join(
        `Professional e-commerce product photography of ${name} in ${color}${fabric ? `, ${fabric} fabric` : ""}, shown on a ${gender} model or as a neat flat-lay, on a clean light-grey studio background.`,
        `The garment is fully visible with natural folds, correct proportions, and true colour, emphasizing ${category} construction and fit.`,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "category-tile":
      return join(
        `A square category-tile image representing "${fallback(fields.name, category)}" for an online store shop-by-category grid: neatly folded or displayed garments from this category, arranged to be instantly recognizable at a glance.`,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "hero-banner":
      return join(
        `A wide homepage hero banner photograph showing ${fallback(subject, "people confidently wearing DAAKYKA hospital scrubs, school uniforms, and kids wear together in a bright, welcoming setting")}.`,
        `Composition leaves clear open space on one side for overlay text.`,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "hospital-scene":
      return join(
        `A softly lit, realistic hospital or clinic setting showing ${fallback(subject, "hospital staff wearing clean, well-fitted scrub sets, lab coats, or patient gowns")}, professional and reassuring in tone, tidy modern healthcare environment in the background.`,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "school-scene":
      return join(
        `A bright, cheerful school setting showing ${fallback(subject, "students wearing smart, well-fitted school uniforms")} in a tidy classroom or campus courtyard.`,
        KIDS_SAFETY_GUIDE,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "kids-scene":
      return join(
        `A warm, playful setting showing ${fallback(subject, "kids wearing comfortable, colourful everyday clothing")} at play or relaxing.`,
        KIDS_SAFETY_GUIDE,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "blog":
      return join(
        `An editorial cover photograph illustrating ${fallback(subject, "fabric care and uniform craftsmanship")}, magazine-style composition with room for a headline overlay.`,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );

    case "avatar":
      return join(
        `A simple, friendly, generic avatar-style image: an abstract or illustrative placeholder portrait (not a real, identifiable person), centered, plain light neutral background, suitable as a small circular profile picture.`,
        STYLE_GUIDE,
        notes,
      );

    case "how-to-measure":
      return join(
        `A clear how-to-measure instructional diagram showing exactly where to measure ${fallback(subject, "chest, waist, and length")} on a garment laid flat or on a simple mannequin/body outline.`,
        `Clean, minimal instructional illustration style with light neutral background and subtle measurement guide lines or arrows.`,
        STYLE_GUIDE,
        BRAND_CONTEXT,
        notes,
      );
  }
}
