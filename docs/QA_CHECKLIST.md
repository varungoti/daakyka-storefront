# DAAKYKA Storefront — QA Checklist

Use before launch and after major releases. **Automated coverage is complete** — run `npm run verify:101` first.

## Storefront

- [x] Homepage loads — hero, offers strip, best sellers, testimonials *(dogfood + E2E)*
- [x] Shop filters work (category, color, size, fabric, price) *(E2E)*
- [x] Product detail — variant selection, add to cart, JSON-LD in page source *(E2E + smoke)*
- [x] Mix & Match builder preview and embroidery field *(dogfood `/mix-and-match`)*
- [x] Cart drawer — add/remove/update quantities *(E2E)*
- [x] Checkout page (`/checkout`) in demo mode *(E2E)*
- [x] Currency toggle INR ↔ USD *(dogfood E2E on staging)*
- [x] Wishlist add/remove *(dogfood)*
- [x] Search (⌘/Ctrl+K) returns products *(dogfood)*
- [x] All 21 SEO guides load with FAQ + breadcrumb schema *(smoke)*
- [x] `/guides` hub links resolve *(smoke)*
- [x] Fabric technology pages load *(dogfood)*
- [x] Bulk order + contact forms submit successfully *(integration + E2E validation)*
- [x] Newsletter signup works *(integration + E2E)*
- [x] WhatsApp FAB opens wa.me link *(dogfood E2E + deploy probe)*
- [x] Mobile nav drawer opens/closes *(E2E)*
- [x] Skip-to-content link works (Tab on load) *(E2E)*
- [x] Dark mode toggle *(dogfood E2E)*

## Admin

- [x] Login redirect when unauthenticated *(admin-security tests + E2E)*
- [x] RBAC — VIEWER cannot access blog edit, users, etc. *(admin E2E + unit tests)*
- [x] Homepage CMS saves hero copy *(admin E2E)*
- [x] Blog create/edit/publish *(admin E2E)*
- [x] Bulk orders + contact enquiries list *(dogfood admin tour)*
- [x] Journeys list + active enrollments *(dogfood)*
- [x] SEO manager — metadata audit + schema validation all green *(dogfood `/admin/seo`)*
- [x] Reputation dashboard shows testimonials + review gaps *(dogfood)*
- [x] Hermes tasks create approval records (never auto-publish) *(admin E2E)*
- [x] Integrations page shows provider status *(dogfood)*
- [x] Audit logs record admin actions *(seed + admin flows)*

## Automated — ✅ COMPLETE

```bash
npm run verify:101   # lint + unit + integration + build + smoke + e2e + dogfood + lighthouse
```

| Layer | Tests | Status |
|-------|-------|--------|
| Unit | 56 | ✅ |
| Integration | 17 | ✅ |
| Smoke | 50 | ✅ |
| Core E2E | 21 | ✅ |
| Dogfood E2E | 51 | ✅ |
| Lighthouse | 6 pages | ✅ (see `dogfood-output/lighthouse/summary.md`) |

**Staging URL:** https://storefront-nu-woad.vercel.app

```bash
npm run verify:101              # local full gate
npm run verify:staging:full     # live staging probe + smoke + e2e + dogfood
```

## Performance (manual)

- [x] Lighthouse audit run — see `dogfood-output/lighthouse/summary.md`
- [ ] Lighthouse mobile perf ≥ 90 on homepage/shop *(currently 78–81 local; Shopify CDN expected to close gap)*
- [ ] LCP < 2.5s on homepage and product page *(measure on staging)*
- [ ] No layout shift on hero/product images *(visual check on staging)*

## Cross-browser (manual — run on staging URL)

- [ ] Chrome desktop
- [ ] Safari desktop
- [ ] Chrome mobile (Android)
- [ ] Safari mobile (iOS)

## Pre-launch sign-off

- [ ] Staging URL reviewed by stakeholder
- [ ] Admin password changed from seed
- [ ] `docs/LAUNCH_CHECKLIST.md` credential steps complete
