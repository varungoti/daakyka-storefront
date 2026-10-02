/**
 * release-hardening audit F-082: both the header's predictive search
 * dialog and /shop?q= used to do a single whole-string `contains` test
 * against a couple of fields ("scrubs", "scrub tops", "lab coats", "bed
 * sheet" and "doctors" all returned "No products found" although the
 * store sells exactly those things), with no ranking (a category-slug
 * substring hit could outrank an actual name match) and no defence
 * against a false positive like "tie" matching "patient" gowns.
 *
 * This tokenizes the query, applies a small stemmer so a plural matches
 * its singular ("scrubs" -> "scrub"), and requires every token to be a
 * *prefix* of some stemmed word in the product's searchable text (never a
 * bare substring — that's what stopped "tie" matching "patient" in the
 * first place). A second, looser check — the query with spaces removed as
 * a substring of the haystack with spaces removed — catches a
 * two-word-vs-one-word spelling gap like "bed sheet" vs "Bedsheet".
 *
 * Shared by src/components/search/search-dialog.tsx and
 * src/components/shop/shop-page-content.tsx's `?q=` search so the two
 * never drift back out of sync with each other.
 */

const SECTION_SEARCH_LABEL: Record<string, string> = {
  HOSPITAL: "hospital",
  SCHOOL: "school",
  KIDS: "kids",
  GENERAL: "",
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Deliberately simple: drop a trailing "es" after s/x/ch/sh, otherwise a
 * trailing "s" (but never "ss"), for any word longer than 3 characters —
 * "scrubs" -> "scrub", "linens" -> "linen", "gowns" -> "gown", but "gas"
 * and "pe" are left alone.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (/(s|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean).map(stem);
}

/**
 * The fields matchProducts ranks on — a structural subset of `Product`, so
 * the header dialog can search the slim index it downloads (F-013, see
 * src/lib/products/public-search-product.ts) as well as full products.
 */
export interface SearchableProduct {
  name: string;
  colorName: string;
  categoryName?: string;
  categorySlug?: string;
  category?: string;
  section?: string;
  tags?: readonly string[];
  colors: readonly { name: string }[];
  fabricTech: readonly string[];
}

function searchableFields(product: SearchableProduct): string[] {
  return [
    product.name,
    product.colorName,
    product.categoryName ?? "",
    // Category slugs are hyphenated ("scrub-tops") — split into words so
    // "scrub tops" tokenizes the same way the product name would.
    (product.categorySlug ?? product.category ?? "").replace(/-/g, " "),
    product.section ? (SECTION_SEARCH_LABEL[product.section] ?? product.section) : "",
    ...(product.tags ?? []),
    ...product.colors.map((c) => c.name),
    ...product.fabricTech,
  ];
}

interface Indexed {
  product: SearchableProduct;
  nameWords: string[];
  otherWords: string[];
  compactHaystack: string;
}

function indexProduct(product: SearchableProduct): Indexed {
  const nameWords = tokenize(product.name);
  const otherFields = searchableFields(product).slice(1); // name is index 0
  const otherWords = otherFields.flatMap(tokenize);
  const compactHaystack = normalize(searchableFields(product).join(" ")).replace(/ /g, "");
  return { product, nameWords, otherWords, compactHaystack };
}

/**
 * Ranks `products` against `query`, best match first. A product must match
 * either every query token (as a prefix of some stemmed word — a name
 * match scores above a tag/category/colour match) or the whole
 * space-stripped query as a substring of the space-stripped haystack.
 * Returns `[]` for a blank query — callers keep their own "empty query"
 * behaviour (e.g. the dialog's default first-N-products list) rather than
 * this module guessing what that should be.
 */
export function matchProducts<T extends SearchableProduct>(products: readonly T[], query: string): T[] {
  const tokens = tokenize(query);
  const compactQuery = normalize(query).replace(/ /g, "");
  if (tokens.length === 0) return [];

  const scored: { product: T; score: number }[] = [];

  for (const product of products) {
    const { nameWords, otherWords, compactHaystack } = indexProduct(product);

    let nameHits = 0;
    let otherHits = 0;
    let everyTokenMatched = true;
    for (const token of tokens) {
      const matchesName = nameWords.some((word) => word.startsWith(token));
      const matchesOther = !matchesName && otherWords.some((word) => word.startsWith(token));
      if (matchesName) nameHits += 1;
      else if (matchesOther) otherHits += 1;
      else {
        everyTokenMatched = false;
        break;
      }
    }

    // Only for a multi-word query: a *single*-word compact check would just
    // be a bare substring search again — the exact bug this module fixes
    // ("tie" ⊂ "patient"). With 2+ words, a false hit needs the words to
    // appear in that exact order with no separator anywhere in the
    // haystack, which is astronomically less likely to happen by accident.
    const compactMatch =
      tokens.length > 1 && compactQuery.length > 0 && compactHaystack.includes(compactQuery);
    if (!everyTokenMatched && !compactMatch) continue;

    const score = (everyTokenMatched ? nameHits * 10 + otherHits : 0) + (compactMatch ? 5 : 0);
    scored.push({ product, score });
  }

  // Array.prototype.sort is stable, so equally-scored products keep their
  // original (caller-supplied) relative order.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.product);
}
