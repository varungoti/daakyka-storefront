# DAAKYKA Store — Release Audit & "Ultimate UX" Plan

Date: 2026-09-19 · Branch: `release-hardening` · Method: four independent audits (security, correctness/caching, shopper UX vs Shopify, admin UX vs Shopify Admin) run against the local production build with live browser walkthroughs and code review, plus `npm audit`. Every P0/P1 below was reproduced, not inferred. Detailed reports with evidence and screenshots: `docs/audit-2026-09-19/{security,correctness,storefront-ux,admin-ux}.md`.

## 1. Where the store stands

Done and verified: full redesign (store-first home, mega menus, hidden pages with admin toggles), native Postgres catalog with admin CRUD/variants/CSV import, RBAC with 10 enforced roles, customer accounts, moderated reviews, Razorpay checkout with order-request fallback, admin-editable encrypted payment/email credentials, 158 real AI product/site images served through the app's `/cdn` proxy, 761 automated tests, CI with a11y + Lighthouse gates. Production database is migrated, seeded, and all 60 products are published. The only thing between the code and a live site is the owner adding 7 secrets to Vercel and triggering the deploy.

Audit totals: **1 P0 · 16 P1 · 23 P2 · 19 P3**. No security P0. The auth, RBAC, payments-signature, token and credential-encryption cores were independently found to be unusually solid.

## 2. What must be fixed before (or with) go-live — Phase 0

| # | Finding | Why it matters | Fix | Effort |
|---|---|---|---|---|
| 0.1 | **P0** Homepage hero/trust-stats/announcement, offers and testimonials edits never reach the live site — `updateHomepageSection`, offers and testimonials CRUD have no `revalidatePath`/`revalidateTag`, and `/` is fully static (in-code comments claim the opposite) | Owner edits copy in `/admin/homepage`, nothing changes until a redeploy | `revalidatePath("/")` (+ `/shop`, category pages) in every write in `src/lib/homepage/index.ts`, `src/lib/offers/index.ts`, `src/lib/testimonials/index.ts`; fix the comments; add a test | S |
| 0.2 | **P1** Rate limiting bypassed by spoofing `X-Forwarded-For` (`src/lib/security/rate-limit.ts:48`) | Every throttle (login, register, checkout, reviews, forms) is defeatable per-request | Use the platform-set client IP (Vercel `x-real-ip`/`x-vercel-forwarded-for`, last trusted hop) and ignore client-supplied XFF | S |
| 0.3 | **P1** `/order/[number]` shows full name/address/items to anyone; numbers are 6 `Math.random()` digits; no rate limit on the page | PII scraping by enumeration (DPDP exposure) | Require the owning customer session OR a signed access token in the confirmation link/email; `crypto.randomInt`; rate-limit the page | M |
| 0.4 | **P1** Order-request fallback creates real orders + decrements stock with no payment and no non-IP throttle | Free "orders" can drain inventory/fulfilment queue once 0.2 is exploited | Per-email/phone throttle + hold stock as *reserved* until admin confirms; CAPTCHA/OTP option | M |
| 0.5 | **P1** Checkout accepts phone `12345` and PIN `AB123` | Undeliverable orders, unreachable customers | 10-digit Indian mobile + 6-digit PIN validation server-side (Zod) and inline client errors | S |
| 0.6 | **P1** `/about` hotlinks founder photos, client logos and process image from `daakyka.com` (times out → 504s; will die when this site replaces it) | The trust page renders empty grey boxes | Import those assets into R2 via `saveMediaAsset` and reference `/cdn/...`; drop `daakyka.com` from the trusted-host list afterwards | S |
| 0.7 | **P1** Go-live docs (`GO_LIVE_RUNBOOK`, `LAUNCH_CHECKLIST`, `HANDOVER`) still say Shopify is the checkout path | Whoever launches will chase the wrong credentials | Rewrite for Razorpay + Supabase + R2 + `/cdn`; mark Shopify cart mode legacy | S |
| 0.8 | Deploy | — | Owner adds `DATABASE_URL`, `ADMIN_SEED_PASSWORD`, `OPENAI_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CREDENTIAL_ENCRYPTION_KEY` to Vercel → `npx vercel --prod` → smoke test | — |

## 3. Trust & correctness — Phase 1 (first week after launch)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 1.1 | **P1** `/api/checkout/verify` and the Razorpay webhook both read `order.status` outside the transaction → possible double stock decrement | Atomic `UPDATE … SET status='PAID' WHERE status<>'PAID'` inside the tx; decrement only if 1 row changed | M |
| 1.2 | **P1** Bulk "adjust price %" can push price above `compareAtPrice` (fake or missing discounts) | Apply the same guard as `updateProduct`; report skipped rows | S |
| 1.3 | **P1** Order/verification emails are silently dropped when Brevo is unset — only a `console.log` | Outbox table with retry once Brevo is configured; admin banner "N emails not sent"; make the customer-facing copy honest | M |
| 1.4 | **P1** Guest checkout mints a fake `Customer` (random email/phone/password) not linked to the order | Don't create a customer for guests; store contact on the order; offer "create account" post-purchase that claims the order | M |
| 1.5 | **P1** Admin product form swallows server errors (negative price → 400, no message) | Toast + inline field errors from the API response; same toast on save/publish success | S |
| 1.6 | **P1** No "resend verification email" → unverified customers can never review | Resend button on the review banner and profile tab (rate-limited) | S |
| 1.7 | P2 `/api/health` and Hermes runtime health leak integration/platform config publicly | Public `{ok:true}`; details behind admin permission | S |
| 1.8 | P2 `/cdn/[...key]` traversal check runs before a second decode | Check after final decode; reject `..`, `/`, `\` | S |
| 1.9 | P3 `proxy.ts` admin gate skips `active`/`sessionVersion`; HSTS only on Vercel; cron open when `NODE_ENV=development` without `CRON_SECRET` | Reuse `verifySessionToken`; `isProduction()` for HSTS; require `CRON_SECRET` unless an explicit test flag | S |
| 1.10 | P2 Business decision: no GST line anywhere | Confirm prices are GST-inclusive (add a "inclusive of GST" label + invoice note) or add a tax line | S/M |

## 4. Shopper experience — Phase 2 (reach and beat Shopify Dawn)

Already better than Shopify: bulk/institutional flows, integrated size guide, fabric facets + price slider, ⌘K predictive search, wishlist, INR/USD toggle, complete JSON-LD, no placeholder copy.

| # | Gap | Fix | Effort |
|---|---|---|---|
| 2.1 | No sticky Add-to-Cart on mobile PDP | Slide-up bar (price + size + CTA) when the main CTA scrolls away | S |
| 2.2 | Account tabs aren't real URLs (`/account/orders` 404s) | Route per tab sharing the dashboard shell | M |
| 2.3 | Colour/size/fabric/price filters don't sync to the URL (reload resets them) | Extend the existing `?category=`/`?q=` pattern to all facets | M |
| 2.4 | No discount-code field at checkout (`Order.discount` exists but unused) | Coupon model + validation + field in checkout; admin Discounts page | M |
| 2.5 | Free-text address, no autocomplete | PIN-code → city/state autofill (India Post API), phone/PIN masks | S |
| 2.6 | No customer-facing order tracking | `/account/orders/[number]` timeline using existing `trackingNumber`/`courier`; WhatsApp/email status updates | M |
| 2.7 | No back-in-stock notify | "Notify me" on sold-out variants → email when restocked (cron) | M |
| 2.8 | No express checkout | Razorpay Magic Checkout / UPI one-tap; evaluate COD toggle for institutional buyers | M |
| 2.9 | Lighthouse mobile 78–79 (CLS 0.54 from shared `min-h-[50vh]` skeleton in 8 `loading.tsx`) | Content-shaped skeletons per route; target ≥90 and raise the CI gate | M |
| 2.10 | Polish: relative JSON-LD image URLs, blank mega-menu thumbs on first hover, WhatsApp bubble over the address field on mobile, lockout message clarity | Absolute URLs; eager-load 3 thumbs; hide bubble while a form is focused; "too many attempts" copy | S |

## 5. Admin "effortless" — Phase 3 (reach and beat Shopify Admin)

Measured today: text + variants product in 60–90 s (faster than Shopify thanks to the size×colour matrix + auto-SKU). With a photo it becomes 3–4 minutes over two page loads.

| # | Gap | Fix | Effort |
|---|---|---|---|
| 3.1 | Images locked until first save | Stage uploads/AI picks in the create form and attach in the same request → true one-pass "under 2 minutes" | L |
| 3.2 | Product/order tables unusable at phone width (owner manages from a phone) | Card layout under 640px for lists; sticky primary actions | M |
| 3.3 | No unsaved-changes guard; no success toasts; "Save draft" label on published products | Dirty-form prompt; unified toast pattern; label "Save changes" | S |
| 3.4 | Plain textarea description | Lightweight rich-text editor (Tiptap) storing sanitised HTML | M |
| 3.5 | No reusable media library | Searchable asset browser usable from any image field; reuse across colourways | L |
| 3.6 | Up/down arrows only for categories and images | Drag-and-drop with keyboard fallback | M |
| 3.7 | Long auto-SKUs (`DK-FORHOS-UXAUDITCLASSICCOMFOR-XS-NAVY`) | Short deterministic product code | S |
| 3.8 | 28 sidebar links across 6 groups; Hermes/Journeys/Intelligence look unconfigured | Collapse Marketing into one hub; hide advanced/AI modules behind a site-control flag until wanted; explicit "dry-run only" copy on Hermes buttons | M |
| 3.9 | "Legacy Shopify Orders" shown beside real orders; "Commit import" looks enabled before a dry run | Retire/merge legacy view; disable Commit until a clean dry run | S |
| 3.10 | No first-run guidance | Dashboard setup checklist (add payment keys, verify email sender, add first product, review shipping rates) like Shopify's home | M |
| 3.11 | No forgot-password hint on admin login; no inventory locations/barcode/cost fields | Help line; backlog the multi-location/cost fields until the business needs them | S / L |

## 6. Platform hygiene — Phase 4

- Remove the dead Shopify cart mode (`src/lib/shopify/*`, `src/lib/cart/service.ts` Shopify functions, `/api/cart`) and README "Cart Modes" section (P1 correctness finding — confusing, GID-shaped, incompatible with the DB catalog).
- CI: explicit per-role RBAC matrix test, credential-store round-trip, `/cdn` route test; `npm audit --omit=dev` gate. Dev-only advisories (14, all `@lhci/cli`/Prisma CLI chains) — upgrade when a non-breaking path exists.
- Dedicated `error.tsx` for `/checkout`; document the one-request SWR lag of `revalidateTag(..., "max")`; comment the intentional no-restock in the stale-order cron; fix the stale `notifications.ts` comment; note the hardcoded USD rate.
- Later: nonce-based CSP to drop `'unsafe-inline'`.

## 7. Execution model

Each phase is a batch of parallel Sonnet 5 subagents on non-overlapping files, each ending with lint + typecheck + tests + build + a browser check + one scoped commit; the orchestrator re-verifies every commit. Phase 0 is ~1 day of work and should ship together with the first deploy; Phases 1–3 are roughly one week each; Phase 4 is opportunistic.

## 8. Decisions needed from the owner

1. Prices GST-inclusive (label only) or add a tax line? (1.10)
2. Express checkout: Razorpay Magic Checkout / UPI one-tap, and should COD be offered to institutional buyers? (2.8)
3. Hide the Marketing/Hermes/AI modules from the admin until the business is ready for them? (3.8)
4. OK to delete the legacy Shopify cart/orders code now that checkout is native? (Phase 4)
5. Deploy: the 7 Vercel env vars (section 2, item 0.8).
