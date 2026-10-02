# Performance Guide — DAAKYKA Storefront

Baseline from Lighthouse (`npm run audit:lighthouse`), last run 2026-05-29:

| Page | Performance | Notes |
|------|-------------|-------|
| `/` | 84 → target 90+ | Hero LCP, JS bundle |
| `/shop` | 85 → target 90+ | Product grid images |
| `/about`, `/institutional` | 90–93 | ✅ |
| Product PDP | 85 | Gallery images |
| Guides | 89 | Near target |

## Optimizations applied

1. **Hero** — Removed Framer Motion from above-the-fold hero; CSS `animate-fade-up` / `animate-scale-in` instead (smaller initial JS).
2. **Code splitting** — Lazy-load only Framer Motion homepage sections (`MixMatchSection`, `BespokeSection`).
3. **Package imports** — `optimizePackageImports` for `lucide-react` and `framer-motion`.
4. **Fonts** — `display: swap`; reduced Outfit weights to 600–800.
5. **Images** — `preconnect` to `images.pexels.com` and `daakyka.com`; hero `priority` + `fetchPriority="high"`.
6. **Shop** — Testimonials section lazy-loaded on shop page.
7. **Image widths** — Card tiles `w=560`, PDP galleries `w=800`, hero `w=960` via `imageWidths` in `catalog.ts`.
8. **Bespoke section** — Server component with CSS animations (removed Framer Motion from homepage).

Latest Lighthouse (local): homepage/shop improved after image width tuning; re-run `npm run audit:lighthouse` after deploy.

## Verify after changes

```bash
npm run build
npm run start
npm run audit:lighthouse
```

Report: `dogfood-output/lighthouse/summary.md`

## Further wins (optional)

- Self-host hero image on CDN with explicit `width`/`height`
- Replace remaining Framer Motion `whileInView` sections with CSS `animation-timeline: view()`
- Add `@next/bundle-analyzer` for bundle regression checks in CI
- Put a real CDN in front of `/cdn/[...key]` (Cloudflare R2's own CDN, or a Vercel/Cloudflare edge cache) for smaller, WebP-served product images

## Lighthouse CI gate (Phase G)

`.github/workflows/storefront-verify.yml`'s `e2e` job runs `npm run test:lighthouse`
(`@lhci/cli` against `lighthouserc.js`) on the same built-and-started server used
for Playwright, mobile-emulated. Measured locally on 2026-09-18 against
`http://localhost:3000` (`dogfood-output/lighthouse-ci/*.report.json`, two
consecutive runs, simulated throttling):

| Page | Performance | Accessibility | Best Practices | SEO |
|------|-------------|----------------|-----------------|-----|
| `/` | 100 | 95 | 89 | 100 |
| `/shop` | 78–79 | 95 | 89 | 92 |
| `/products/mens-cargo-scrub-pants` | 79 | 96 | 96 | 92–100 |

**Root cause of the `/shop` and PDP performance gap (fixed release-hardening,
2026-09-20):** not JS/image weight — FCP/LCP/TBT/TTI all scored 0.93–1.0 on
both pages even before this fix. The culprit was Cumulative Layout Shift
(CLS ≈ 0.54, scoring 0.14/1): the Lighthouse `layout-shifts` audit attributed
essentially the entire shift to the page `<footer>`. The shared route-level
Suspense fallback (`PageLoadingState` in `src/components/ui/spinner.tsx`,
used by `src/app/shop/loading.tsx` and 7 other `loading.tsx` files) was only
`min-h-[50vh]`, far shorter than the real `/shop` (or PDP) content (~17,600px
of product grid/filters/testimonials). When the real content streamed in and
replaced that skeleton, the footer — sitting near the viewport during the
brief skeleton paint — jumped ~17,600px down in one shift, which Lighthouse
scored as a large, viewport-adjacent layout shift.

**Fix:** each of the 8 `loading.tsx` files now renders a content-shaped
skeleton from the new `src/components/ui/route-skeletons.tsx` (`ShopGridSkeleton`
for `/shop` + `/category/[slug]`, `ProductDetailPageSkeleton` for the PDP,
`SectionLandingSkeleton` for `/for-hospitals` + `/kids-wear` + `/school-uniforms`,
`AccountPageSkeleton` for `/account`, `AdminPanelContentSkeleton` for the
admin panel) instead of the one generic `PageLoadingState` block. Each
skeleton reuses the real component's own wrapper classNames (padding,
`max-w-[1320px]`, grid columns) so the reserved space actually matches the
incoming content, per Next's own streaming guidance
(`node_modules/next/dist/docs/01-app/02-guides/streaming.md`: "Design skeleton
fallbacks that match the dimensions of the content they represent").

Before/after, mobile Lighthouse (`npm run test:lighthouse`, single run each,
simulated throttling, measured on this same machine so before/after are
comparable — see the historical 0.54 CLS row above for the originally
*documented* baseline, captured on different hardware/run):

| Page | Performance (before → after) | CLS (before → after) |
|------|-------------------------------|-----------------------|
| `/` | 0.83 → 0.85 | 0.000 → 0.000 |
| `/shop` | 0.80 → 0.79 | 0.000 → 0.000 |
| `/products/mens-cargo-scrub-pants` | 0.71 → 0.84 | 0.277 → 0.004 |

CLS is now effectively eliminated on all three (and structurally fixed on
all 8 routes, not just the ones Lighthouse CI measures). The PDP is the
clearest before/after: it was the one URL actually *failing* the 0.75 gate
(0.71) before this fix, and comfortably passes (0.84) after.

**Why the gate stays at `minScore: 0.75`, not 0.90 (as of the CLS fix):**
CLS is no longer the bottleneck, but LCP is — 3.9–4.6s on all three pages
after the fix (audit score 0.35–0.53), same order of magnitude as before.
That's a separate, pre-existing problem (the `unused-javascript` opportunity
flags ~112–115 KiB on every page, and TBT is 220–250ms on `/shop`/PDP), not
something this CLS fix touches. Per the instruction that shipped this fix:
raise the threshold only once Performance reaches ≥90 consistently — it
plateaued at 0.79–0.85, short of that, so the threshold is left exactly as
it was rather than raised partway. Next candidate follow-up: investigate
the shared JS bundle (`unused-javascript` savings) and LCP element
discovery/priority.

## LCP / JS-weight follow-up (release-hardening, 2026-09-20)

Picking up that fix's own follow-up note. Measured fresh (3 runs per URL
per condition, mobile, simulated throttling, `npm run test:lighthouse`,
median reported — single runs are noisy) rather than reusing the numbers
above, so this section's "before" differs slightly from the CLS section's
(different hardware/run, same order of magnitude).

**LCP element per URL** (Lighthouse's `largest-contentful-paint-element`
audit):

- `/` — **not an image.** The hero's `<h1>` headline (some runs: the
  descriptive `<p>` beneath it). The hero images already had `priority`.
  Under simulated mobile throttling (4x CPU), main-thread JS evaluation was
  delaying even plain text paint — the unthrottled trace showed ~510ms of
  Script Evaluation + ~80ms Script Parsing in `mainthread-work-breakdown`,
  which scales ~4x under simulation — so cutting JS payload/execution
  mattered more here than any image fix could.
- `/shop` — the first product grid card's image (`<img alt="Kids
  Hoodie">`). It had no `priority`/`preload`/`fetchPriority` at all, so it
  fell back to `next/image`'s default `loading="lazy"` — the LCP candidate
  was telling the browser to defer its own fetch.
- PDP (`/products/mens-cargo-scrub-pants`) — the gallery's main product
  image, already using the (deprecated) `priority` prop.

**Bundle offenders found, with evidence:**

1. **Zod leaking into the client bundle on every page — the single
   biggest fix.** `src/lib/validation/honeypot.ts` had an unused
   `export const honeypotSchema = z.object(...)` sitting next to the
   `HONEYPOT_FIELD_NAME` constant that `NewsletterSignup` (rendered in the
   footer, present on every non-admin route) actually imports. A bundler
   includes a whole module's top-level code once any of its exports is
   imported, so that dead schema dragged the *entire* zod v4 library into
   the client on `/`, `/shop`, and the PDP alike — confirmed by grepping
   the built `.next/static/chunks/*.js` for the full `ZodAny`/`ZodArray`/
   .../`ZodVoid` export surface sitting in a 60,790-byte chunk that
   Lighthouse's `unused-javascript` audit flagged as 86–90% unused (~52
   KiB wasted) — accounting for almost all of the "~112–115 KiB" figure
   this section opened with. Fix: delete the dead schema and its
   `import { z } from "zod"` (nothing else in the repo referenced it —
   verified with a repo-wide grep). Result: `grep -rl "ZodObject"
   .next/static/chunks/*.js` returns zero matches post-fix, and the
   `unused-javascript` savings dropped from ~116–118 KiB to ~64–66 KiB
   median on all three pages — a ~44–45% cut, reproduced across 3 separate
   before/after measurement rounds.
2. **`sanitize-html`: investigated, not an actual offender.**
   `src/lib/catalog/description-html.ts` imports it, and a comment in
   `product-detail.tsx` references that file, but nothing there actually
   imports it (confirmed by grep — the only hit was the comment, not an
   import). Confirmed absent from every built chunk both before and after
   (`grep -rl "sanitizeHtml\|disallowedTagsMode\|htmlparser2"
   .next/static/chunks/*.js` → no matches). Ruled out with evidence.
3. **`ImageLightbox` statically imported into two high-traffic client
   components.** `product-detail.tsx` (PDP) and `product-card.tsx`
   (rendered a dozen-plus times on `/shop`, `/`, and the PDP's
   related-products row) both statically imported it despite only ever
   rendering it behind `{condition && <ImageLightbox />}`. Converted both
   to `next/dynamic(..., { ssr: false })` (keeping a type-only import for
   `LightboxImage`). Because these really are conditionally mounted, this
   defers the fetch until a shopper actually opens the viewer — a clean
   win, no measured downside.
4. **framer-motion via CartDrawer/WishlistDrawer/SearchDialog/
   MobileFilterDrawer — tried `next/dynamic`, measured a net loss,
   reverted.** All four render unconditionally (open/closed is internal
   or prop state, not conditional JSX mounting), so `next/dynamic` doesn't
   defer their fetch — the import() still fires as soon as they render on
   the client, just via an extra Suspense/lazy layer instead of a plain
   static import. Measured over a full build + 3-runs-per-URL cycle: the
   framer-motion chunk's wasted-byte count was *identical* before and
   after (36,394 bytes, 90% unused, every run), while median Performance
   and LCP got *worse* on all three URLs (e.g. `/shop` LCP 4519ms →
   5348ms). Reverted to static imports. A real fix would need to defer
   *mounting*, not just the import mechanism, until first interaction —
   left as a follow-up; it touches focus-trap/open-state timing this pass
   didn't have test coverage to change safely.
5. **`/shop`'s product grid had no prioritized image at all, then an
   over-correction.** `ProductCard`'s image had no
   `priority`/`preload`/`fetchPriority`, so every card — including
   whichever one is the LCP element — defaulted to lazy loading. Added a
   `loadEagerly` prop threaded from `ProductGrid`. First attempt
   prioritized the whole first row (`index < 4`, the `xl:` 4-column
   breakpoint) and measured *worse* median LCP on `/shop` (4519ms →
   4821ms): the tested mobile viewport (412px) is below the `sm:` 640px
   breakpoint, so that grid is a single column there, and 3 of those 4
   preloaded images were below the fold, competing for bandwidth against
   the one that mattered — exactly the scenario `node_modules/next/dist/
   docs/01-app/03-api-reference/02-components/image.md` warns about under
   `preload`: "When you have multiple images that could be considered the
   LCP element depending on viewport." Narrowed to `index === 0` only:
   median LCP improved to 4451ms (vs. 4519ms baseline), Performance
   0.83 → 0.84.
6. **No other bundle offenders.** No chart library, no carousel library
   (both absent from `package.json` entirely), and no server-only package
   (`openai`, `sharp`, `@aws-sdk/*`, `pg`, `@prisma/client`, `razorpay`,
   `bcryptjs`) is imported by any `.tsx` file — checked directly with grep
   across all of `src/`.

**`priority` → `preload` migration (Next.js 16 deprecation).** Confirmed
against `node_modules/next/dist/docs/01-app/03-api-reference/02-components/
image.md`: `priority` still functions in this Next 16.3.5 build
(`get-img-props.js` maps `preload: preload || priority`, so it wasn't
silently broken), but is deprecated in favor of `preload`. Migrated all 6
occurrences (`hero-section.tsx`, `product-detail.tsx`,
`shop-page-content.tsx`, `mix-match-visualizer.tsx`, `image-lightbox.tsx`,
`page-shell.tsx`) — behavior-preserving per that internal equivalence.
`fetchPriority="high"` stayed alongside `preload` on the hero image
(existing behavior, not redesigned).

**Fonts and third-party scripts: checked, not changed.**
`next/font` (`Outfit`/`DM Sans` in `src/app/layout.tsx`) already uses
`display: "swap"` and a trimmed weight set from an earlier pass; every
configured weight has real usage sitewide (checked via grep counts of the
`font-*` Tailwind utilities), so there was nothing safe left to cut. The
WhatsApp widget is a plain `<a>` tag, not a script. Razorpay's checkout
script was already loaded on demand only from the checkout page (verified
via grep, unchanged).

**Server response time / caching: not a factor.** `server-response-time`
(TTFB) medians were 10–79ms across all three pages, every round measured.
`/` is fully static (`○ /` in the build output); `/shop` and the PDP are
dynamic but backed by `unstable_cache`-tagged reads. Caching design and
`revalidateTag` invalidation untouched.

**Before/after median Performance and LCP, 3 runs per URL per condition:**

| URL | Performance (before → after) | LCP (before → after) | unused-javascript (before → after) |
|---|---|---|---|
| `/` | 0.81 → 0.82 | 4927ms → 4788ms | 117.9 KiB → 65.9 KiB |
| `/shop` | 0.83 → 0.84 | 4519ms → 4451ms | 117.1 KiB → 65.1 KiB |
| PDP | 0.86 → 0.88 | 4146ms → 3687ms | 115.9 KiB → 64.0 KiB |

CLS held at ~0 on `/`/`/shop` and 0.004–0.005 on the PDP — no regression of
the earlier CLS fix.

**Why the gate stays at `minScore: 0.75`:** none of the three URLs reached
0.90, even after nearly halving unused JavaScript on every page. The
remaining ~64–66 KiB of "unused" JS is now almost entirely the
framer-motion chunk (cart/wishlist/search/filter drawers) and the
React/React-DOM/Next.js client runtime itself — see point 4 above for why
the obvious next move (dynamic-importing the drawers) measured worse, not
better, and was reverted rather than kept on the strength of theory alone.
LCP is still 3.7–4.8s under simulated mobile throttling, and for `/`
specifically the LCP element is plain text, meaning the bottleneck there is
main-thread CPU contention (script evaluation + hydration, amplified ~4x
under simulation) rather than any single render-blocking resource —
`render-blocking-resources` only flags one CSS file worth ~150–160ms. Per
the standing instruction: raise the threshold only once Performance reaches
≥0.90 consistently; it improved (unused-JS roughly halved, LCP down
2.8–11% depending on the page) but plateaued in the low-to-mid 0.80s, so
the threshold is left exactly as it was. Next candidate follow-up: a real,
interaction-gated (not just import-mechanism) deferral of the cart/
wishlist/search/filter drawers, and/or reducing how much of the
SiteShell's client-component tree needs to hydrate before first paint.

**Gate thresholds set in `lighthouserc.js`** (mobile, mirrors the axe a11y
gate already in CI):

- `categories:performance` — **error** at `minScore: 0.75`. Not the master-plan
  target of 0.90 — LCP now keeps `/shop` and the PDP below that (see above) —
  but comfortably above the ~0.71 floor that used to fail this gate, with
  real margin for CI-runner noise. Raise this once LCP is addressed and
  Performance reaches ≥90 consistently.
- `categories:accessibility` — **error** at `minScore: 0.90`, matching the
  existing `test:a11y` axe gate.
- `categories:best-practices` / `categories:seo` — **warn** at `minScore: 0.90`
  (home/`/shop` best-practices measured 0.89, just under the floor; warn-level
  so it's visible without blocking CI on a single point).

## Cacheable listings and product pages, lighter payloads, lazier motion (release-hardening wave 4)

Findings F-013, F-018, F-256, F-257, F-258, F-260, F-261. Measured on local
production builds (`next build` + `next start` against a seeded Postgres, 60
products), baseline = the commit before this work, mobile Lighthouse with
simulated throttling, median of 3 runs.

**What was dynamic, and is not any more.** `/shop`, `/category/[slug]` and
`/products/[handle]` were rendered by a function on every view
(`Cache-Control: private, no-cache, no-store`), and `GET /api/products` — what
the header search dialog downloads — was a function run too. They are
prerendered now (`○ /shop`, `● /category/[slug]`, `● /products/[handle]`,
`○ /api/products` in the build output) and served with `s-maxage=300,
stale-while-revalidate`:

- `/shop` and `/category/[slug]` no longer take a `searchParams` prop (reading
  it opts the route into per-request rendering). The server and the first client
  render show the unfiltered grid; `ShopPageContent` applies `?category=`/`?q=`/
  facets right after hydration. The only `useSearchParams()` call is in a tiny
  `ShopUrlSync` component inside its own `<Suspense>` (on a prerendered route it
  makes the tree up to the nearest boundary client-only, so it must not be the
  component that renders the grid). The page keeps its own filter state so a
  click filters the grid on the same frame; `src/lib/shop/url-sync.ts` stops the
  router's lagging echo of the page's own `history.pushState`/`replaceState`
  writes from typing over what a shopper typed meanwhile (a stale echo would
  otherwise drop the space in "scrub top"). A side effect: a search from the header
  dialog while already on `/shop` now actually applies (it was ignored before,
  the page only read the URL on mount). A filtered deep link
  (`/shop?category=…`) shows the unfiltered grid for the moment between the HTML
  and hydration.
- `/category/[slug]` and `/products/[handle]` export an empty
  `generateStaticParams()`. Without it a dynamic segment is rendered on every
  request however static its page is; with it each slug is rendered on first
  visit and then cached. Nothing is built ahead, so the build does not need the
  catalogue for them.
- The one thing on the product page that read the request was the signed-in
  visitor's review eligibility (`cookies()`). It is `GET
  /api/products/[handle]/review-eligibility` now (`private, no-store`), asked
  by the review section from the browser only once the section is about to
  scroll into view. The server still re-checks everything on submit.
- Invalidation is by the tags the reads already carry — an admin save, a stock
  change at checkout/payment/cancel, a review approval each call
  `revalidateTag`. Checked end to end: after an order, the product page is
  regenerated with the new stock on the very next request (`expire: 0`) and
  `/shop` one request later (`"max"`, stale-while-revalidate); a cached 404 for a
  not-yet-published handle is purged when it is published. A database outage can
  no longer be cached as a 404 or as "no reviews": `getProductByHandle` rethrows
  outside the seed-fallback case and the product page reads its reviews with
  `{ strict: true }`.

**Payloads (F-013, F-257).** The search index is
`{id, handle, name, colorName, price, image, category…}` per product — 51 KB →
22 KB raw (5.7 → 2.8 KB brotli), cached at the CDN, downloaded once per page
session (a shared promise, preloaded on hover/focus of the Search button, never
on a plain page load) instead of on every open. The listing pages and the home
page hand the client `toShopCardProduct(p)` (no descriptions/SEO/legal fields,
one preview image per colour, variants cut to what Quick Add needs): 202 KB →
120 KB raw (17.2 → 11.8 KB brotli) for the 60 seeded products; `/shop` HTML
460 → 364 KB raw (31.8 → 26.4 KB brotli). Not done: server-side pagination of
the listing. Filters, facet counts and search all run in memory over the whole
list, which is what lets the route be static; the grid already renders 24 cards
at a time ("Load more", F-021).

**Prefetch (F-260).** Scrolling `/shop` on a phone made 60 product-page
prefetch requests (56 distinct). `ProductGrid` cards now prefetch on intent
(pointer over, touch, keyboard focus) with `router.prefetch`, once per card;
scrolling prefetches none. (`<Link prefetch={false}>` also turns off the Link's
own hover prefetch, so it has to be done by hand.)

**Bundle (F-258).** The cart, wishlist, search and filter overlays use `m.*`
inside `LazyMotion` instead of the full `motion` component: the up-front
framer-motion chunk went from 125 KB raw / 41 KB gzip to about 57 KB / 21 KB
(shared with other modules, esbuild puts the bare core at ~9 KB gzip), and the
animation features (`domAnimation`, ~13 KB gzip) are a separate chunk fetched on
the visitor's first press/touch/key/focus, so a page that is only read never
downloads it. Initial JS per storefront page: `/about` 212.7 → 190.6 KB gzip,
`/shop` 234.3 → 212.7 KB gzip. Until the features arrive an overlay opens in
its final state (`useMotionInitial`) — no slide, but never an invisible cart
drawer if the chunk is late or fails to load. `optimizePackageImports:
["framer-motion"]` makes no difference to the chunk under Turbopack. Admin pages
still import the shell (and so this core) through the root layout; moving the
storefront chrome into a route group would remove that and is not part of this
change.

**LCP priority (F-261).** `ProductGrid` only preloads its first card's image when
the caller passes `eagerFirst` (`/shop`, `/category/[slug]`). The home page's
Featured grid sits several screens below the hero and used to preload an image
next to it (2 image preloads in `/`, now 1).

| URL | Performance | LCP | Unused JS | Transfer |
|---|---|---|---|---|
| `/shop` | 0.88 → 0.88 | 3.91 → 3.81 s | 64 → 27 KiB | 472 → 430 KiB |
| a product page | 0.90 → 0.90 | 3.61 → 3.63 s | 66 → 30 KiB | 429 → 404 KiB |
| `/` (5 alternating runs) | 0.85 → 0.89 | 4.26 → 3.74 s | 66 → 30 KiB | 475 → 450 KiB |

`/shop` and the product page barely move: under simulated 4x CPU throttling their
LCP is dominated by main-thread work rather than by the bytes removed here. The
gains there are in unused JavaScript, transfer, server work (a cached page
instead of a function run from `hnd1` per view) and the 60 fewer prefetches per
scroll. The home page's LCP element is text whose paint moves between two
values from run to run (~3.8 s and ~4.3 s in the baseline), which is why it was
measured with 5 alternating runs.

## Targets (master plan Part 16)

| Metric | Target |
|--------|--------|
| Lighthouse Performance | ≥ 90 |
| Lighthouse Accessibility | ≥ 90 |
| Lighthouse SEO | ≥ 90 |
| Lighthouse Best Practices | ≥ 90 |
