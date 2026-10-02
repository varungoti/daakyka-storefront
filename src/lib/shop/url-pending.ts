/**
 * F-018 follow-up: what a hard load of a FILTERED listing URL looks like.
 *
 * /shop and /category/[slug] are prerendered, so the server HTML and the first
 * client render are the UNFILTERED grid; the URL's facets are only applied once
 * ShopPageContent has hydrated (ShopUrlSync). On a phone that gap was measured at
 * about two seconds (/shop?category=scrub-tops painted 24 wrong cards at ~600 ms
 * and the right 3 at ~2.6 s, then jumped), and a filtered link is exactly what a
 * shared link, a reloaded or restored tab and Google's sitelinks search box
 * (the JSON-LD SearchAction -> /shop?q=...) all land on.
 *
 * The fix keeps the static HTML (SEO, CDN) and only stops the wrong grid being
 * PAINTED: a tiny inline script, first child of the results container, marks that
 * container `data-shop-url-pending` while the URL carries any shop param, CSS
 * hides it (and shows a skeleton in its place) for as long as the mark is there,
 * and ShopUrlSync removes the mark in the same layout effect that applies the
 * URL's filters — so the shopper never sees the unfiltered grid.
 *
 * Why the mark is on the container and not on <html>: React 19 clears every
 * attribute of <html>/<head>/<body> when it hydrates them (acquireSingletonInstance
 * in react-dom), which would remove the mark before the filters are applied.
 *
 * It is a script, not a CSS rule, because nothing in CSS can read the query
 * string; it runs while the HTML is parsed, ahead of the first card's paint.
 */

/** The attribute the inline script sets on the results container and
 * ShopUrlSync removes. */
export const SHOP_URL_PENDING_ATTR = "data-shop-url-pending";

/** Every query param that changes what the grid shows — everything
 * `applyShopFiltersToSearchParams` writes (category, q, colors, sizes, fabrics,
 * price, sale, stock, sort) plus `show` (how many "Load more" pages to restore).
 * Anything else in the query string (utm_* tags, gclid, ...) leaves the grid as
 * it is rendered, so it must not hide it. Kept in step with filters.ts by the
 * test next to ShopPageContent's. */
export const SHOP_URL_PENDING_PARAMS = [
  "category",
  "q",
  "colors",
  "sizes",
  "fabrics",
  "price",
  "sale",
  "stock",
  "sort",
  "show",
] as const;

/** Safety net: if the page never hydrates (the JS failed to load) nothing would
 * ever remove the mark and a filtered link would show an empty page for good,
 * so the script also removes it after this long. Generous — a phone on a slow
 * connection measured ~2.6 s from request to the applied filters — and, once it
 * fires, the shopper sees the server-rendered (unfiltered) products, which is
 * what every link and crawler sees anyway. */
export const SHOP_URL_PENDING_FAILSAFE_MS = 6000;

/** Whether `search` (a `location.search`-style query string) carries a param
 * ShopPageContent applies after hydration. The inline script below is the
 * browser-side twin of this function. */
export function shopSearchNeedsUrlSync(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return SHOP_URL_PENDING_PARAMS.some((key) => Boolean(params.get(key)));
  } catch {
    return false;
  }
}

/** ES5, no dependencies, wrapped in try/catch: it runs before React and must
 * never be able to throw into the page. `document.currentScript` is the script
 * itself (parser-inserted, so it is set), whose parent is the results
 * container. */
export const SHOP_URL_PENDING_SCRIPT = [
  "(function(){try{",
  "var p=new URLSearchParams(location.search),k=",
  JSON.stringify(SHOP_URL_PENDING_PARAMS),
  ",i,on=false;",
  "for(i=0;i<k.length;i++){if(p.get(k[i])){on=true;break}}",
  "if(!on)return;",
  "var el=document.currentScript.parentElement,a=",
  JSON.stringify(SHOP_URL_PENDING_ATTR),
  ";",
  'el.setAttribute(a,"");',
  "setTimeout(function(){el.removeAttribute(a)},",
  String(SHOP_URL_PENDING_FAILSAFE_MS),
  ")",
  "}catch(e){}})()",
].join("");
