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
- Connect Shopify CDN product images (smaller, WebP) when live catalog is wired

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

## Targets (master plan Part 16)

| Metric | Target |
|--------|--------|
| Lighthouse Performance | ≥ 90 |
| Lighthouse Accessibility | ≥ 90 |
| Lighthouse SEO | ≥ 90 |
| Lighthouse Best Practices | ≥ 90 |
