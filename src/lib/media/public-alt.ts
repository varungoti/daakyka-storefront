/**
 * release-hardening audit F-087: a `MediaAsset.alt` is not always shopper-
 * facing text. Assets created through the image-generation script
 * (scripts/generate-images.ts) are given the *manifest slot label* as their
 * alt — "Contact — Banner", "Homepage Band — For Hospitals", "Homepage Hero
 * — Slide 2", "Category — Scrub Sets" — which names an admin slot, not what
 * is in the photo, so a screen reader announced it verbatim. Anything shaped
 * like one of those labels is treated as "no alt text yet".
 *
 * The prefixes are the groups src/data/media/image-manifest.ts builds its
 * labels from (pinned to the manifest by public-alt.test.ts, so a new group
 * can't silently slip through).
 */
const INTERNAL_LABEL =
  /^(?:About|Bulk Orders|Contact|Homepage (?:Band|Hero|Tile)|Our Story|Size Guide|Blog Cover|Category)\s+[—–-]\s+/;

export function isInternalMediaLabel(alt: string): boolean {
  return INTERNAL_LABEL.test(alt.trim());
}

/**
 * The alt text to render for a media asset: the asset's own alt when it is
 * real descriptive text, otherwise `fallback` (default `""`, i.e. the image
 * is treated as decorative — the right call next to a visible heading that
 * already says the same thing).
 */
export function publicImageAlt(alt: string | null | undefined, fallback = ""): string {
  const trimmed = alt?.trim() ?? "";
  if (!trimmed || isInternalMediaLabel(trimmed)) return fallback;
  return trimmed;
}
