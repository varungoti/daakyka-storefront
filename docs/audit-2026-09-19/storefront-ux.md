# DAAKYKA Storefront — Customer-Experience Audit vs Shopify (Dawn + Shopify Checkout)

**Scope:** Read-only, black-box audit of the running build at `http://localhost:3000` (local Docker Postgres, 57 products / 29 categories), driven with headless Playwright at desktop (1280×800) and mobile (390×844). A throwaway account (`ux-audit-*@example.com`) was registered and used to exercise cart, checkout, account, and review flows. No source files were modified. Razorpay is unconfigured locally, so checkout uses the built-in "order request" fallback, evaluated on its own merits.

**Cleanup note:** the `DATABASE_URL` in `.env` points at `daakyka_dev` on `localhost:5432`; a read-only query against it after the test run shows **0 rows in `Customer`**, meaning the running `:3000` server is bound to a different local database than the one in `.env` (confirmed via `SELECT current_database()`). No test data could be found there to delete, and — per instructions — `SUPABASE_DATABASE_URL` was never touched. Flagging this env mismatch for the team so a real cleanup pass can target the right database.

## Summary by severity

| Severity | Count | Meaning |
|---|---|---|
| P0 (blocker) | 0 | Nothing observed blocks browsing, cart, checkout, or account creation outright |
| P1 (high) | 3 | Reproduced, shopper- or trust-facing defects |
| P2 (medium) | 4 | Reproduced UX/consistency gaps |
| P3 (polish) | 5 | Minor/cosmetic issues, incl. one pre-documented perf item |

## Top 5 shopper-facing problems

1. **`/about` is broken on every load** — founder photos, most of the "Trusted by" client-logo wall, and the process image all 504 (hardcoded fetch to `https://daakyka.com/...`), leaving the site's key trust page looking abandoned.
2. **Checkout accepts garbage contact/address data** — a 5-digit phone number and a letters-in-pincode value were both accepted and the order placed successfully; no Indian phone/PIN format validation exists.
3. **Reviews are a dead end for anyone whose verification email doesn't arrive** — there is no "resend verification" affordance anywhere in the app, so a lost/undelivered email permanently blocks that customer from ever reviewing.
4. **Account sections (Orders/Addresses/Reviews/Wishlist/Profile) have no real URLs** — they're pure client-side tab state; refreshing, bookmarking, or deep-linking any of them (e.g. `/account/orders`) 404s.
5. **No sticky "Add to Cart" on mobile PDP** — after scrolling to read description/reviews, the shopper must scroll all the way back up to buy.

---

## Findings

| ID | Sev | Journey | Title | Evidence | Impact | Recommended fix | Effort |
|---|---|---|---|---|---|---|---|
| F1 | P1 | Landing/Trust | `/about` images all 504 (founders, client-logo wall, process image) | `d-about-full.png`; repro: `GET /_next/image?url=https%3A%2F%2Fdaakyka.com%2Fowner%2Fkamal.jpg...` → 504 | "Meet the Founders" shows two empty grey boxes, ~13 of 17 client logos are blank, process section image is blank — undermines the credibility this page exists to build | Point image sources at the local CDN/media store (`/cdn/media/...`) instead of the live `daakyka.com` domain, or fix `images.remotePatterns`/proxy so the optimizer can actually resolve them | S |
| F2 | P1 | Checkout | No format validation on phone / PIN code | `c-submit-with-errors.png` (only the empty `Full name` field is blocked by native "required" validation); order for phone `12345`, pincode `AB123` was placed successfully and cart cleared | Orders can be created with undeliverable addresses and unreachable phone numbers — real operational cost (failed deliveries, no way to contact customer) for a Pan-India institutional shipper | Add `pattern`/regex validation for 10-digit Indian mobile and 6-digit PIN, with inline error text (not just native browser tooltips) | S |
| F3 | P1 | Reviews | No "resend verification email" anywhere; unverified customers are permanently blocked from reviewing | `f-cart-drawer-add2.png` shows the PDP banner: *"Please verify your email address before writing a review — check your inbox..."*; codebase search for resend/verify logic returns no route or UI | If the original verification email is lost, delayed, or (as here, no Brevo) never sent, the customer has no in-app recovery path and can never write a review | Add a "Resend verification email" button/link on the account/profile page and on the gating banner itself | S |
| F4 | P2 | Account | Account tabs (Orders/Addresses/Reviews/Wishlist/Profile) aren't real routes | `evidence-account-orders-404.png`; confirmed via `curl`: `/account/orders`, `/account/addresses`, `/account/wishlist`, `/account/profile`, `/account/reviews` all → **404** | Can't bookmark, share, or deep-link "my orders"; back/forward doesn't move between tabs; a refresh always drops back to the default tab | Give each tab its own route (`/account/orders` etc.) that renders the same dashboard shell with the right tab active | M |
| F5 | P2 | Browse/Filters | Category & text-search filters sync to the URL; colour/size/fabric/price do not | `evidence-color-filter-no-urlsync.png`: clicking "Midnight Navy" drops the grid from 58→0 products but the URL stays `/shop`; a reload silently resets the colour filter back to 58 | Inconsistent, confusing: a shopper can lose their colour/size/fabric selection on refresh or fail to share a fully-filtered link, while a category link works fine | Extend the existing `?category=`/`?q=` URL-param pattern to colour, size, fabric, and price-range facets | M |
| F6 | P2 | PDP/Mobile | No sticky "Add to Cart" bar on mobile PDP | `m-pdp-scrolled.png`; confirmed no such component exists in `src/` (grep for sticky/add-to-cart) | On a long PDP (gallery + description + accordions + reviews + related products), the buy buttons scroll out of view and the shopper must scroll back to the top to purchase | Add a slide-up sticky bar (price + Add to Cart) once the main CTA scrolls out of the viewport on mobile | S–M |
| F7 | P2 | Checkout | No discount/coupon code field | `f-checkout-loggedin.png` / `c-checkout-page.png` — Contact, Shipping address, Order Summary only | Any promo/marketing campaign relying on a code can't be redeemed at checkout | Add an optional "Have a code?" field wired to the existing `discount` field already present on the `Order` model | M |
| F8 | P3 | Navigation | Mega-menu category thumbnails render blank on first hover from the homepage | `evidence-megamenu-home-blank-thumbs.png` (blank grey tiles) vs `diag-megamenu-shop.png` (same menu opened from `/shop`, images load) | Minor visual glitch, self-corrects on second hover/deeper pages | Preload/eagerly load the 3 small mega-menu thumbnails instead of lazy-loading them | S |
| F9 | P3 | SEO | Product JSON-LD `image` array uses relative paths | `pdp-jsonld.json`: `"image":["/cdn/media/product/...webp", ...]` | Schema.org/Google Rich Results guidance expects absolute image URLs in structured data; some parsers may fail to resolve relative paths | Resolve to absolute URLs (same helper already used for `og:image` and canonical) before emitting JSON-LD | S |
| F10 | P3 | Mobile/Checkout | WhatsApp chat bubble overlaps the "Address line 2" field on mobile checkout | `m-checkout.png` (green bubble sits over the input) | Can partially block the tap target on small screens | Reposition/hide the floating bubble while a form is focused on mobile, or move it up | S |
| F11 | P3 | Performance | Confirmed CLS root cause on `/shop` and PDP (pre-documented) | `docs/PERFORMANCE.md`: shared `PageLoadingState` skeleton is only `min-h-[50vh]` vs ~17,600px real page height → footer jumps ~17,600px when content streams in; Lighthouse CLS ≈0.54 (mobile) | Large layout shift right after first paint, feels janky, drags Lighthouse Performance to 78–79 vs the ≥90 target | Per-route skeleton height (or a content-shaped skeleton) instead of one shared `min-h-[50vh]` fallback across 8 `loading.tsx` files | M |
| F12 | P3 | Account/Security | One reproducible "Invalid credentials" on a previously-working test login after repeated automated attempts | Not screenshotted at the DB level; login returned 401 with generic "Invalid credentials" text | Could not fully confirm whether this is the app's own `failedLoginCount`/`lockedUntil` brute-force lockout (present in the `Customer` schema) firing correctly, or a genuine bug — the generic message is actually good practice (doesn't leak lockout state) if intentional | Verify lockout UX under normal (non-scripted) retry cadence; consider a distinct "too many attempts, try again in N minutes" message so real customers aren't confused | S (investigation) |

---

## Shopify parity gaps

| Feature | Shopify (Dawn/Shopify Checkout) | This store | Priority |
|---|---|---|---|
| Express/1-click checkout | Shop Pay, Apple Pay, Google Pay | None (Razorpay only, unconfigured locally); no BNPL | High |
| Discount codes at checkout | Native field, stacking rules | No UI field (F7); `discount` column exists in `Order` but unused at checkout | High |
| Address autocomplete/validation | Google-backed autocomplete + format checks | Free-text only, no format validation (F2) | High |
| Bookmarkable account sections | `/account/orders`, `/account/addresses` etc. are real pages | Client-state tabs only, 404 on direct URL (F4) | Medium |
| Full facet→URL sync | All active filters persist in the URL | Category & search sync; colour/size/fabric/price don't (F5) | Medium |
| Back-in-stock notifications | Native/app-based "Notify me" | Not implemented (no matching code found) | Medium |
| Gift cards | Native | Not implemented | Low–Medium |
| Order tracking page | Dedicated tracking timeline, carrier links | `Order` model has `trackingNumber`/`courier` fields but no customer-facing tracking UI observed | Medium |
| Abandoned-cart emails | Native, automatic | `CartAbandonmentEvent` model + `/api/cart/abandon` exist, so infra is there; actual send depends on Brevo (unverifiable locally) | Low (infra present) |
| Sticky mobile add-to-cart | Standard on Dawn PDP | Missing (F6) | Medium |

## Where this store beats Shopify

- **Institutional/bulk flows are first-class**, not bolted on: dedicated `/for-hospitals`, `/school-uniforms`, `/bulk-orders` with their own lead forms, WhatsApp CTA, and a "Need bulk pricing? Enquire" link right on the PDP — Shopify needs a wholesale app or Shopify Plus for this.
- **Size Guide is genuinely integrated**: per-category charts (hospital scrubs, school, kids) linked directly from the PDP, not an external page or app embed.
- **Fabric-technology faceted filtering** (4-Way Stretch, Liquid Repellent, Anti-Microbial, Moisture Wicking, EcoFlex Sustainable) plus a price-range slider ship natively — on Shopify this typically needs a paid Search & Discovery/filter app.
- **Predictive `⌘K` search** returns live product thumbnails, colour, and price as you type — comparable to or better than Dawn's default search.
- **Native wishlist and dual-currency (INR/USD) toggle with correct, persisted conversion** (₹599 → $7.00, held across navigation) both ship out of the box; Shopify needs apps for either.
- **Structured data is unusually complete for a non-Shopify build**: Organization, WebSite+SearchAction, Product, and BreadcrumbList JSON-LD are all present on the PDP (minor relative-URL nit, F9) — many stores need an SEO app to get this far.
- **Content quality is high** — no lorem ipsum or placeholder copy found anywhere across `/our-story`, `/sale`, `/bulk-orders`, `/size-guide`, `/contact`, unlike a default, unfinished Dawn install.

---

*Screenshots and raw text/HTML captures referenced above are in `dogfood-output/audit/scratch-storefront/`. Scripts used to drive the audit (`audit1`–`audit7_*.mjs`) are left in place for reference; none modify site data beyond the one throwaway account/order created for testing.*
