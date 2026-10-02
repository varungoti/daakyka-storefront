/**
 * Owner-facing wording for the machine identifiers Hermes stores —
 * snake_case task/approval types ("daily_seo_health_scan"), SCREAMING_CASE
 * modes and statuses ("SUGGEST_ONLY", "COMPLETED"). The admin Hermes page
 * used to print them raw (or with only the underscores swapped out), which
 * reads like a database dump to the shop owner.
 */

/** Words that stay upper-case in a sentence-case label. */
const ACRONYMS = new Set(["seo", "ai", "faq", "url", "cta", "kpi"]);

/** "daily_seo_health_scan" -> "Daily SEO health scan", "SUGGEST_ONLY" -> "Suggest only". */
export function humanizeHermesLabel(raw: string): string {
  const words = raw
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "";
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}
