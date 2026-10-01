/**
 * Pure helpers for the blog body and slug — deliberately free of `db` so the
 * admin editor, the Hermes approval executor, the public readers and unit
 * tests can all share them.
 *
 * `BlogPostRecord.content` is a JSON array of paragraph strings (see the
 * admin blog routes, which write `JSON.stringify(parsed.data.content)`).
 * Every reader used to `JSON.parse(record.content) as string[]` blindly, so a
 * row holding anything else — the plain text the Hermes approval executor
 * used to store (F-213), a hand-edited value — crashed the admin editor
 * ("Something went wrong loading this page") and, for a PUBLISHED row, the
 * whole public blog read (which then silently fell back to the seed posts).
 */

/** Splits free text into trimmed, non-empty paragraphs on blank lines. */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Reads a stored `content` value back into paragraphs. Never throws: a JSON
 * array of strings is used as-is (empty entries dropped); a JSON string, or
 * anything that isn't JSON at all (legacy plain text), is split on blank
 * lines instead.
 */
export function parseBlogContent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof parsed === "string") return splitIntoParagraphs(parsed);
  } catch {
    // Not JSON — legacy plain text; fall through.
  }
  return splitIntoParagraphs(raw);
}

/**
 * Builds the paragraph list for a Hermes-created draft: an array payload is
 * used as-is, a string payload is split on blank lines, and anything else
 * (no `draftContent` at all) falls back to `fallback`. Always returns at
 * least one paragraph so the post satisfies blogPostSchema's `.min(1)`.
 */
export function paragraphsFromDraft(draft: unknown, fallback: string[]): string[] {
  let paragraphs: string[] = [];
  if (Array.isArray(draft)) {
    paragraphs = draft
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (typeof draft === "string") {
    paragraphs = parseBlogContent(draft);
  }
  if (paragraphs.length > 0) return paragraphs;
  const fallbackParagraphs = fallback.map((item) => item.trim()).filter(Boolean);
  return fallbackParagraphs.length > 0 ? fallbackParagraphs : ["Draft generated from Hermes approval."];
}

/**
 * Lowercase, hyphen-only slug matching blogPostSchema's
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$` (a slug with spaces, capitals or a colon
 * saves but 404s on /blog/<slug>, F-216). Unlike catalog/category-validation's
 * slugify, returns "" when nothing alphanumeric survives so the caller
 * chooses its own fallback.
 */
export function blogSlugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}
