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

**Why the gate stays at `minScore: 0.75`, not 0.90:** CLS is no longer the
bottleneck, but LCP is — 3.9–4.6s on all three pages after the fix (audit
score 0.35–0.53), same order of magnitude as before. That's a separate,
pre-existing problem (the `unused-javascript` opportunity flags ~112–115 KiB
on every page, and TBT is 220–250ms on `/shop`/PDP), not something this CLS
fix touches. Per the instruction that shipped this fix: raise the threshold
only once Performance reaches ≥90 consistently — it plateaued at 0.79–0.85,
short of that, so the threshold is left exactly as it was rather than
raised partway. Next candidate follow-up: investigate the shared JS bundle
(`unused-javascript` savings) and LCP element discovery/priority.

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
