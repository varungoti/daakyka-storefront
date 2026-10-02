/**
 * Small, dependency-free HTML helpers shared by every transactional email
 * (src/lib/email/layout.ts, src/lib/orders/order-email.ts, the back-in-stock
 * and customer-auth mailers). Kept free of DB/settings imports so they are
 * trivially unit-testable.
 */

/** Escapes a value for use as HTML text *or* inside a double-quoted
 * attribute. Everything a shopper or an admin can type (names, addresses,
 * product names, tracking numbers) goes through this before it reaches an
 * email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Plain-text rendition of an HTML email body, used as the `text/plain`
 * part when a caller doesn't supply its own.
 *
 * The old fallback (`html.replace(/<[^>]+>/g, "")`) dropped every URL — the
 * text part of a password-reset email read "…reset your password.Reset
 * passwordThis link expires in 1 hour" with no link at all, and the
 * sentences ran together. This keeps each link as `label (url)`, turns
 * block-level ends into line breaks, and decodes entities.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "")
    // Keep the destination of every link — `label (url)`, or just the url
    // when the label already is the url.
    .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_match, dq, sq, inner: string) => {
      const href = decodeEntities((dq ?? sq ?? "").trim());
      const label = decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (!href || href.startsWith("#")) return label;
      if (!label || label === href || label === href.replace(/^(mailto|tel):/i, "")) return href;
      return `${label} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "  ")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");

  text = decodeEntities(text);
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
