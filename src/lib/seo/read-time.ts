const WORDS_PER_MINUTE = 200;

/**
 * release-hardening F-155: src/data/blog.ts hardcodes each seed post's
 * `readTime` (e.g. "6 min read" on an ~80-word post, "4 min read" on a
 * ~33-word one) — computing it from the actual word count instead means a
 * post can never be mislabelled as a longer read than it is, without
 * having to touch that data file. Always at least "1 min read".
 */
export function computeReadTime(paragraphs: string[]): string {
  const wordCount = paragraphs.reduce(
    (sum, paragraph) => sum + paragraph.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return `${Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE))} min read`;
}
