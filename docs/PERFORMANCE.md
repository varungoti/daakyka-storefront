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

## Targets (master plan Part 16)

| Metric | Target |
|--------|--------|
| Lighthouse Performance | ≥ 90 |
| Lighthouse Accessibility | ≥ 90 |
| Lighthouse SEO | ≥ 90 |
| Lighthouse Best Practices | ≥ 90 |
