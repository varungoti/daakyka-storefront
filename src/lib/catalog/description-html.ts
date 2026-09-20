import sanitizeHtml from "sanitize-html";

/**
 * release-hardening F-12 (docs/audit-2026-09-19/admin-ux.md): product
 * descriptions move from a plain `<textarea>` to a lightweight rich-text
 * editor (see src/components/admin/rich-text-editor.tsx). This module is
 * the single source of truth for what that editor is allowed to produce,
 * for sanitizing it before it ever reaches the database, and for turning
 * whatever ends up in `Product.description` — new sanitized HTML *or* one
 * of the 60 existing plain-text descriptions already in the catalog — into
 * safe output for both the admin editor and the storefront.
 *
 * Design decision (storage format): store sanitized HTML, not markdown.
 * Justification:
 *  - The admin editor is a `contentEditable` surface (see
 *    rich-text-editor.tsx) — browsers natively produce/consume HTML for
 *    that, so storing HTML avoids a markdown<->HTML round-trip on every
 *    keystroke/load.
 *  - `Product.description` already holds plain text today; plain text is
 *    already valid *unformatted* HTML (no tags to misinterpret), so HTML
 *    storage is backward-compatible by construction — see
 *    `looksLikeSanitizedHtml`/`descriptionToSafeHtml` below, which treat
 *    anything without a recognized tag as legacy plain text rather than
 *    trying to parse it as markdown.
 *  - A small, fixed allowlist (below) sanitized through `sanitize-html` (a
 *    dedicated, widely-used sanitization library — not a hand-rolled
 *    regex) is straightforward to render safely on both ends: the admin
 *    editor loads it straight into `contentEditable`, and the storefront
 *    renders it with `dangerouslySetInnerHTML` only after it has passed
 *    back through this same sanitizer (defense in depth: never trust that
 *    a DB value is still exactly what was last written).
 *
 * Security boundary: the *only* place a description is safe to persist is
 * after `prepareDescriptionForStorage` — see createProduct/updateProduct
 * (src/lib/catalog/products.ts) and the CSV import commit path
 * (src/lib/catalog/product-import.ts). Client-side sanitization (if any,
 * in the editor itself) is a UX nicety only; it is never the trust
 * boundary, since it can always be bypassed by calling the API directly.
 */

/** Tags the rich-text editor's toolbar can produce (p/br/strong/em/ul/ol/
 * li/a), plus a few more that are safe to keep if present in pasted
 * content (b/i/u/h3/h4/blockquote) — a strict allowlist either way, never
 * "everything except a blocklist". No `img`, `script`, `style`, `iframe`,
 * `svg`, form elements, or event-handler/`style`/`class` attributes are
 * ever allowed. */
export const ALLOWED_DESCRIPTION_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "h3",
  "h4",
  "blockquote",
] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_DESCRIPTION_TAGS],
  // `rel`/`target` are listed here because the *filter* step runs after
  // the transform below, not because a caller can set them directly: the
  // transform unconditionally overwrites both to a fixed safe value first
  // (merge=true means "overwrite these specific keys", not "only if
  // absent"), so whatever the source HTML had is always discarded.
  allowedAttributes: { a: ["href", "title", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  // Force a safe rel/target on every link rather than trusting one the
  // admin might type into an href-adjacent field some day — there's no
  // toolbar affordance for rel/target today, but this makes the guarantee
  // hold even if that changes later.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }, true),
  },
  disallowedTagsMode: "discard",
  // Belt-and-suspenders: strip these entirely (tag *and* content) even
  // though they were never in allowedTags, so a clever nested-tag payload
  // (e.g. "<scr<script>ipt>") can't smuggle script/style content out as
  // plain text after the outer disallowed tag is discarded.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed"],
};

const HTML_TAG_PATTERN = new RegExp(`</?(${ALLOWED_DESCRIPTION_TAGS.join("|")})(?:[\\s/>]|$)`, "i");

/**
 * Cheap, deliberately narrow "is this our sanitized HTML, or legacy/plain
 * text" detector: true only when a tag from our own allowlist appears, so
 * plain text that merely contains a literal "<" (e.g. "Sizes < XL run
 * small") is never mistaken for markup and doesn't get HTML-escaped into
 * "Sizes &lt; XL" on the storefront.
 */
export function looksLikeSanitizedHtml(value: string): boolean {
  return HTML_TAG_PATTERN.test(value);
}

/** Sanitizes a raw HTML string against the allowlist above. Idempotent —
 * safe to run more than once on the same value (re-sanitizing already-safe
 * HTML is a no-op), which is what lets both the write path and the render
 * path call it independently as defense in depth. */
export function sanitizeDescriptionHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}

/**
 * Normalizes any incoming product description — from the rich-text editor,
 * a CSV import cell, or a script — into what actually gets persisted.
 * HTML (from the editor) is sanitized against the allowlist; anything that
 * doesn't look like our HTML (a plain CSV cell, a hand-typed value) is left
 * as trimmed plain text exactly as it always was. This is what keeps the
 * 60 existing plain-text descriptions byte-for-byte unchanged on disk
 * unless an admin actually re-saves them through the new editor.
 */
export function prepareDescriptionForStorage(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return looksLikeSanitizedHtml(trimmed) ? sanitizeDescriptionHtml(trimmed) : trimmed;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Upgrades legacy plain text into safe paragraph HTML: a blank line
 * starts a new `<p>`, a single newline becomes `<br>` within one — this is
 * purely a display upgrade (every character is HTML-escaped first) so it
 * can never introduce markup that wasn't already sanitized elsewhere. */
function plainTextToParagraphHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()).replace(/\n/g, "<br>"))
    .filter(Boolean);
  return paragraphs.map((p) => `<p>${p}</p>`).join("");
}

/**
 * Renders any stored description — new sanitized HTML *or* one of the
 * existing plain-text rows — as safe HTML for `dangerouslySetInnerHTML`.
 * Used by both the storefront PDP's Description accordion and the admin
 * editor's initial value (so an old plain-text product opens already
 * formatted into paragraphs instead of one unbroken blob).
 */
export function descriptionToSafeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return looksLikeSanitizedHtml(value) ? sanitizeDescriptionHtml(value) : plainTextToParagraphHtml(value);
}

/**
 * Plain-text projection for contexts that can never render HTML — the SEO
 * meta/OpenGraph description, JSON-LD `description`, and the short teaser
 * line on the PDP above the accordion. Strips tags rather than escaping
 * them, so old and new descriptions alike read as normal prose there.
 */
export function descriptionToPlainText(value: string | null | undefined): string {
  if (!value) return "";
  if (!looksLikeSanitizedHtml(value)) return value.replace(/\s+/g, " ").trim();
  // Insert a space at block/line boundaries *before* stripping tags, so
  // "<p>One</p><p>Two</p>" reads as "One Two" rather than "OneTwo" once
  // the tags themselves are gone.
  const withBoundaries = value.replace(/<\/(p|li|h3|h4|blockquote)>|<br\s*\/?>/gi, " ");
  return sanitizeHtml(withBoundaries, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}
