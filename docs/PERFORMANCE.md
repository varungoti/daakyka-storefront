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

**Root cause of the `/shop` and PDP performance gap:** not JS/image weight —
FCP/LCP/TBT/TTI all score 0.93–1.0 on both pages. The culprit is Cumulative
Layout Shift (CLS ≈ 0.54, scoring 0.14/1): the Lighthouse `layout-shifts` audit
attributes essentially the entire shift to the page `<footer>`. The shared
route-level Suspense fallback (`PageLoadingState` in `src/components/ui/spinner.tsx`,
used by `src/app/shop/loading.tsx` and 6 other `loading.tsx` files) is only
`min-h-[50vh]`, far shorter than the real `/shop` (or PDP) content (~17,600px
of product grid/filters/testimonials). When the real content streams in and
replaces that skeleton, the footer — sitting near the viewport during the
brief skeleton paint — jumps ~17,600px down in one shift, which Lighthouse
scores as a large, viewport-adjacent layout shift.

This wasn't fixed as part of the Phase G CI task: `PageLoadingState` is a
shared primitive across 8 route `loading.tsx` files, so resizing it needs a
per-route look (a fixed larger skeleton height only helps if it doesn't
overshoot on already-short pages like `/account`) rather than a one-line
change, and the storefront is mid-flight with other concurrent changes to
adjacent UI right now. Tracked as a follow-up rather than guessed at here.

**Gate thresholds set in `lighthouserc.js`** (mobile, mirrors the axe a11y
gate already in CI):

- `categories:performance` — **error** at `minScore: 0.75`. Not the master-plan
  target of 0.90 — that's not yet true of `/shop` or the PDP (see above) — but
  above the ~78 floor measured today with real margin for CI-runner noise.
  Raise this once the CLS root cause above is fixed and re-measured.
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
