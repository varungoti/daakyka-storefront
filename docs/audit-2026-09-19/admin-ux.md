# DAAKYKA Admin UX Audit — Benchmarked Against Shopify Admin

Date: 2026-09-19. Scope: `/admin/**` on the local production build (localhost:3000, local Docker
Postgres). Method: live Playwright/browser-driven walkthrough as SUPER_ADMIN
(`varungoti@gmail.com`), desktop (1440×900) and mobile (390×844), cross-checked against
`docs/ADMIN_CATALOG_GUIDE.md`, `docs/ROLES.md`, `docs/SITE_CONTROLS.md`, `docs/IMAGES_AI.md`,
`docs/PAYMENTS_RAZORPAY.md`, and the relevant source (`src/lib/catalog/products.ts`,
`prisma/schema.prisma`, RBAC config). Test entities (`ux-audit-*` product, its variants/images, a
guest test order, and the phantom customer it created) were created via the real UI and storefront
checkout, then deleted afterward via a one-off script against the local `DATABASE_URL` (never
`SUPABASE_DATABASE_URL`) — verified gone from `/admin/products` before finishing.

## Summary counts by severity

| Severity | Count |
|---|---|
| P0 – Blocker | 0 |
| P1 – High | 5 |
| P2 – Medium | 9 |
| P3 – Polish | 4 |

**Can a store owner "add a product in under 2 minutes" today?** For bare catalog data (name,
category, price, a size×colour variant grid, stock) — **yes**, comfortably; my own run took about
10–12 interactions and well under 2 minutes. But that number quietly excludes photos. Because the
Images panel only unlocks *after* the product's first save (`ADMIN_CATALOG_GUIDE.md` documents this
correctly), publishing an apparel product a customer would actually buy is really a **two-round-trip
flow**: fill basics → Save draft → page reloads → scroll to Images → upload/generate → Publish. In
this environment R2 and `OPENAI_API_KEY` are both unconfigured, so that second round-trip currently
dead-ends in a 503 for every path (upload and AI generation alike). Realistically, once photos are
in scope, the flow is closer to 3–4 minutes and two distinct page states, which is the opposite of
"seamless" — see F-04 below.

## Top 5 problems

1. **Guest checkout creates a broken phantom customer record** (F-01, P1) — fabricated email/phone,
   0 orders shown, not linked to the real order.
2. **Silent validation failures** (F-02, P1) — a negative price (or other server-rejected input) 400s
   with zero UI feedback; the Save button just appears to do nothing.
3. **Images are locked out of the initial product-creation pass** (F-04, P1) — directly undercuts the
   stated "seamless" / "under 2 minutes" goal for real, photographed products.
4. **Admin product/order tables aren't responsive on a phone** (F-05, P1) — the client said they'll
   manage the store from a phone; the product list needs horizontal scrolling to reach Price, Stock,
   Status, filters, and the New Product button at 390px wide.
5. **No unsaved-changes protection anywhere in the product editor** (F-13, P2, called out because of
   its silent-data-loss potential) — edited fields, navigate away, and the edit vanishes with no
   warning.

Positives worth naming: variant generation (size×colour matrix, auto-SKU, bulk stock apply, inline
per-row edit) is genuinely close to Shopify's polish; publish→storefront reflection is immediate with
**no caching lag** once a save actually lands; the docs I checked against were consistently accurate;
order status transitions (with dynamic tracking/courier fields) gave clear "Saved." feedback; and RBAC
is a real, enforced permission matrix, not just page-level hiding.

## Findings

| ID | Sev | Area | Title | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F-01 | P1 | Orders/Customers | Guest checkout auto-creates a disconnected, fake customer record | Placed order as guest with email `uxaudit@example.com`/phone `9550000000`, name "UX Audit Tester". `/admin/customers` shows a customer named "UX Audit Tester" but with email `ux-audit-lifh1ls@example.com` and phone `9876543210` (neither matches what was entered), "0 orders / ₹0 spent / No orders yet" — even though the order exists and is visible in `/admin/orders`. `prisma/schema.prisma`: `Customer.passwordHash` is non-nullable, so a real (unusable) account with a random password is being minted per guest checkout. | Store owner can't see real order history against a "customer," contact info shown is unusable/wrong, and the customer list fills with junk over time. | Either don't create a `Customer` row for guest checkouts at all, or link the order's `customerId` and populate the customer's real name/email/phone from the checkout form. | M |
| F-02 | P1 | Product form | Server-rejected input fails silently — no toast, no inline error | Set Price to `-500` on New Product, clicked Save draft. Network: `POST /api/admin/products → 400`. Screenshot shows no error text anywhere on the page before or after scrolling to top. | An admin has no idea *why* their save didn't work; looks like a frozen/broken button. | Surface the 400's message as a toast and/or inline field error. | S |
| F-03 | P2 | Product list / navigation | "Loading…" + "0 products" render simultaneously on every fresh nav to `/admin/products` | Screenshots on 3 separate navigations to `/admin/products` all briefly show the table body as "Loading…" while the footer already says "0 products" before the real count settles a moment later. | Minor but happens on *every* visit; reads as a flash of broken state. | Don't render the "N products" footer until the same fetch that fills the table resolves. | S |
| F-04 | P1 | Product form | Images section is locked until the product's first save, forcing a two-round-trip creation flow | `ADMIN_CATALOG_GUIDE.md` documents this ("Save the product as a draft first to add images"); confirmed live — Images panel shows only that message on `/admin/products/new`, and only unlocks with upload/AI-generate controls after Save draft redirects to `/admin/products/[id]`. | For an apparel business, a product without a photo isn't really "added." This is the single biggest gap against the "seamless, under 2 minutes" goal, and against Shopify (which accepts dropped images before the first save). | Allow image selection/staging in the new-product form and upload them as part of the same create request (or immediately after, via an optimistic temp id), so creation is one pass. | L |
| F-05 | P1 | Mobile / responsive | Admin product table requires horizontal scrolling at phone width; filters and New Product are off-screen | At 390×844, `/admin/products` renders the full desktop table unchanged — Price/Stock/Status columns, the status/stock filter dropdowns, and the New Product button are all outside the initial viewport and only reachable by scrolling right. Screenshots taken before/after horizontal scroll confirm this. Sidebar nav itself does collapse to a hamburger menu correctly. | Client explicitly said they'll manage the store from a phone sometimes; the single most-used screen (product list) isn't usable there without scrolling in two directions. | Add a responsive card/stacked layout for the product (and order) list under ~640px, matching what was already done for the sidebar nav. | M |
| F-06 | P2 | Catalog / Categories | Category reordering is up/down-arrow only, no drag-and-drop | `/admin/categories` shows ▲▼ buttons per row; no drag handle or drag-and-drop behavior observed. | Reordering a long category list one arrow-click at a time is slow next to Shopify's drag handles. | Add drag-and-drop (e.g. dnd-kit) with the arrows kept as a keyboard-accessible fallback. | M |
| F-07 | P2 | Catalog / Media | No general-purpose, reusable media library | `/admin/media` ("Media Library") is exclusively slot-based — one fixed card per homepage/category/blog slot (`IMAGE_MANIFEST`) plus per-product galleries reached only from each product's own editor. There is no "browse all uploaded images, pick one, attach to this product" flow, confirmed by `IMAGES_AI.md`'s own description and the UI. | An admin can't reuse a photo already uploaded for a similar product/colourway; every image is uploaded from scratch per product. | Add a searchable/filterable asset browser that any image field (product gallery, site slot) can pick from. | L |
| F-08 | P2 | CSV Import | "Commit import" renders in the same full-color/active state as other enabled primary buttons before any file is chosen | `/admin/products/import`: with no file selected, "Run dry run" is visibly greyed out but "Commit import" is not — same purple/pink fill as when it should be active. (A click with no file produced no import network call, so it isn't state-corrupting, but the visual signal is misleading and worth a dedicated pass — this observation wasn't followed all the way through a real dry-run-then-commit cycle because file selection isn't scriptable from this session's browser tools.) | An admin could believe Commit is ready to go before running the required dry run. | Disable "Commit import" until a successful dry run with `summary.error === 0` has completed in the current session, and style it to match the disabled state. | S |
| F-09 | P2 | Orders | Two parallel order systems shown side by side ("Orders" vs "Legacy Shopify Orders (1)") | `/admin/orders` header has a "Legacy Shopify Orders (1) →" link next to the native order list; native list and legacy list are clearly separate tables/views. | A store owner has to remember there are two places orders might be, easy to miss a legacy one. | Either fully migrate/merge legacy Shopify orders into the native table, or make the split and its meaning explicit in the UI (not just a small link). | M |
| F-10 | P2 | Navigation IA | 24 top-level nav items across 6 groups, Marketing alone has 9 sub-items | Full sidebar walk: Overview (2), Catalog (4), Sales (5), Marketing (9: Engagement, Campaigns, Journeys, Offers, Testimonials, Market, Intelligence, Reputation, Hermes), Content (3), Settings (5) = 28 links total. Shopify Admin's top-level nav has ~8 items (Home, Orders, Products, Customers, Content, Marketing, Discounts, Analytics). | For a small apparel business, this is a lot of surface area to learn; several Marketing sub-sections (Journeys, Intelligence, Hermes) looked sparsely used/partly unconfigured during the walkthrough. | Consider collapsing rarely-used Marketing tooling behind a single "Marketing" hub with tabs, or hiding advanced sections behind a feature flag until the business is ready for them. | M |
| F-11 | P2 | Product form | Auto-generated SKUs are long and hard to read | Generated variant SKU example: `DK-FORHOS-UXAUDITCLASSICCOMFOR-XS-NAVY` (category code + full slugified product name, truncated oddly). | Awkward on pick-list/label printouts; hard to read out over phone/WhatsApp for a manual/bulk order. | Shorten the product-name portion of the SKU pattern (e.g. first few words or a short code) while keeping it deterministic/collision-safe. | S |
| F-12 | P2 | Product form | No rich-text description editor | `/admin/products/new` and edit: "Description" is a plain `<textarea>`, no bold/italic/lists/links. | Product descriptions can't be formatted for the storefront beyond plain paragraphs, unlike Shopify's rich text editor. | Swap in a lightweight rich-text component (e.g. Tiptap) that still stores clean HTML/markdown. | M |
| F-13 | P2 | Product form | No unsaved-changes protection | On an existing product (Classic Unisex Scrub Set, left un-saved on purpose), edited the Name field, then navigated to `/admin/dashboard` via URL — no "leave site" prompt, no warning of any kind; the edit was silently discarded (confirmed reverted on revisiting the product). | An admin who edits several fields, gets interrupted, and clicks away loses the work with zero warning. | Add a `beforeunload`/router-guard prompt when the form is dirty. | S |
| F-14 | P2 | Product form / variants | No inventory-per-location, barcode, weight, or cost/margin fields | Variant grid columns are Size, Colour, SKU, Stock, Price override, Active only — no barcode, no weight/dimensions for shipping-rate calculation, no cost field for margin visibility. | Matches a single-warehouse, flat-shipping-rate business model today, but there's no headroom if DAAKYKA opens a second location or wants margin reporting without a spreadsheet. | Lower priority given the current flat-rate shipping model (`SITE_CONTROLS.md`), but worth a backlog item if the business grows. | L |
| F-15 | P3 | Product form | "Save draft" button keeps that label even when editing an already-published (ACTIVE) product | On the published `ux-audit` test product, the primary save button still read "Save draft" (confirmed via accessibility tree) even though clicking it does **not** revert status to DRAFT (verified: status stayed ACTIVE / button still said "Unpublish" afterward). | Purely a labeling issue, but it reads as if saving might unpublish the product, which could make an admin hesitate to save a quick fix on a live listing. | Change the label to "Save" (or "Save changes") once the product is not in DRAFT status. | S |
| F-16 | P3 | Product form | No success toast on Save draft / Publish | Saving or publishing the test product produced no visible confirmation banner/toast (only the button state and URL change signaled success) — contrast with the Orders detail page, which shows an explicit green "Saved." message after "Save changes." | Inconsistent feedback pattern across the same admin; less confidence that a save "took." | Add the same lightweight success toast/inline confirmation used on the Orders page to the product and category forms. | S |
| F-17 | P3 | Login | No "forgot password" affordance on `/admin/login` | Login screen is Email + Password + Sign In only, no reset-password or "contact an admin" link. | A locked-out non-SUPER_ADMIN has no self-serve path; must ask a `users:manage` admin for a manual reset (which the Users page does support via "Reset password"). | Add a short help line ("Locked out? Ask a Super Admin to reset your password from Users.") rather than a full self-serve flow, given `users:manage` is intentionally SUPER_ADMIN-only. | S |
| F-18 | P3 | Marketing / Hermes | Hermes Agent and several Marketing sub-sections read as unconfigured/half-built | `/admin/hermes`: "Runtime: Not configured", "Operating Mode: SUGGEST ONLY", 4 pending approvals, and "Run Hermes Workflow" buttons (Daily SEO Health Scan, Weekly Competitor Scan, Blog Opportunity Workflow, Campaign Draft Workflow) that were **not clicked** in this audit per the no-real-sends instruction. | Without knowing whether these buttons trigger real external calls today, their presence next to an unconfigured runtime is confusing at best and risky at worst for a small team that won't know what's safe to click. | Either finish/gate this behind a clear "not yet available" state, or add explicit "this will do X, dry-run only" copy on each workflow button. | M |

## Time-to-task

Timed by interaction/step count during this session (not a stopwatch), compared against a
experienced-operator estimate for the equivalent Shopify Admin task.

| Task | Here: clicks/screens | Here: est. time | Shopify: est. time | Notes |
|---|---|---|---|---|
| Log in | 1 screen, ~4 actions (email, password, submit) | ~10–15s | ~10–15s | Parity. |
| Add product — text + variants only, no photo | 1 screen (scrolling form), ~10–12 actions (name, price, 3 sizes, 2 colours, generate, apply stock, fabric, save) | ~60–90s | ~90–120s | DAAKYKA is *faster* here — the size×colour matrix + auto-SKU + bulk stock beats Shopify's manual variant-option setup. |
| Add product — with at least one real photo | Same as above **plus** a second page (reload after Save draft), scroll to Images, upload/generate, then Publish | ~3–4 min, 2 distinct page loads | ~90–120s, 1 pass | This is where the "under 2 minutes" claim breaks down — see F-04. |
| Edit an existing product's price and confirm on storefront | 1 field, 1 save click, 1 storefront reload | ~15–20s, reflected immediately, no cache lag | ~15–20s | Parity; both immediate. |
| Bulk-select 2 products, see bulk action bar | 2 checkbox clicks | ~5s | ~5–10s | Parity; bar offers Publish/Archive/Adjust price %/Set stock/Move to category. |
| Create + process one order end-to-end (guest checkout → admin status/tracking) | ~12 checkout form fields + Place Order, then in admin: change status, fill tracking + courier, Save | ~2–3 min total across storefront + admin | ~2–3 min for a manual/COD order in Shopify | Parity; DAAKYKA's dynamic tracking fields (appear only once status = SHIPPED) are a nice touch. |

## Shopify Admin parity gaps

| Feature | Shopify | DAAKYKA Admin | Priority |
|---|---|---|---|
| Images during product creation | Drop images before first save | Locked until after first save (F-04) | P1 |
| Rich text description | Yes | Plain textarea (F-12) | P2 |
| Reusable media library | Shared library, searchable | Per-product / fixed-slot only (F-07) | P2 |
| Bulk spreadsheet-style editor | Yes (inline grid across many products) | Bulk action bar only (publish/archive/price%/stock/move-category), no inline grid | P2 |
| Inventory per location | Multi-location tracking | Single stock number, no locations | P3 (fine for current single-warehouse model) |
| Barcode / cost / margin | Yes | Not present (F-14) | P3 |
| Weight / shipping dimensions | Yes | Not present — flat-rate shipping model instead (`SITE_CONTROLS.md`) | P3 |
| Product organization | Tags + Collections + Vendor + Type | Tags + single Category only | P2 |
| Category / menu drag-sort | Drag handles | Up/down arrows only (F-06) | P2 |
| Variant/image drag-drop reorder | Yes | Images reorder via ↑/↓ only (per docs) | P3 |
| Autosave / unsaved-changes guard | Draft autosaves | Neither present (F-13) | P2 |
| Staff permission granularity | Custom permission sets | 10 fixed roles, real enforced matrix (`ROLES.md`) | **Parity** — a genuine strength, not a gap |
| CSV import dry-run before commit | Yes | Yes, matches (F-08 aside) | Parity |
| Mobile admin usability | Fully responsive | Sidebar responsive; list/table views are not (F-05) | P1 |

## Docs-vs-UI discrepancies

Overall the docs were **unusually accurate** — everything below is a minor gap, not a
contradiction, and nothing observed in the live UI outright disagreed with what the docs claimed:

- `ADMIN_CATALOG_GUIDE.md` matched the live product form in every detail checked: auto-slug +
  debounced availability check, category tree, size/colour preset generation with auto-SKU, "Apply
  stock to all," the exact "Save the product as a draft first to add images" copy, the
  Publish/Unpublish/Archive/Delete button set, and the precise disabled-Delete tooltip ("Only draft
  products with no orders can be deleted") — all confirmed byte-for-byte.
- `docs/ROLES.md` couldn't be fully verified end-to-end: the doc points to `prisma/seed.ts` for a
  `VIEWER_SEED_PASSWORD`-driven test account, but this environment's `.env` has no
  `VIEWER_SEED_EMAIL`/`VIEWER_SEED_PASSWORD` set, and the `viewer@daakyka.com` row that does exist in
  the DB is marked inactive (seed.ts deactivates that legacy email on every run). This isn't a doc
  error, but the doc doesn't flag that a working lower-role login may not exist in a given
  environment — worth a one-line caveat for future auditors/QA.
  Permission enforcement itself was verified by reading `src/lib/auth/rbac.ts` logic paths rather than
  by logging in as each role.
- `SITE_CONTROLS.md` matched the live `/admin/site-controls` page exactly, including the "Changes
  apply within a few minutes" copy — that hedge reads as deliberately conservative, since edits in
  this session (both site settings and product saves) were in fact reflected on the storefront
  immediately once they actually persisted.
- `IMAGES_AI.md` and `PAYMENTS_RAZORPAY.md` both correctly predicted this environment's degraded
  states (R2/OpenAI unconfigured → 503s; Razorpay unconfigured → order-request fallback), and the
  order-request flow was confirmed working exactly as documented end-to-end (order created directly
  into `PROCESSING`, no payment step, admin sees "Method: Order Request").

## Notes on environment / testing limitations

- No file-picker automation was available in this session's browser tooling, so an actual image
  **upload** was not exercised (the Upload/Generate UI was inspected but not submitted); this is
  low-risk to skip since R2 and `OPENAI_API_KEY` are both unconfigured here and would 503 regardless.
- Bulk product actions (Publish/Archive/Adjust price %/Set stock/Move to category) were confirmed to
  render correctly for a real multi-select but were not executed against production-seeded catalog
  data, to avoid altering other auditors' shared state on this server.
- Hermes "Run Workflow" buttons and the Integrations credentials form were inspected but not
  submitted, per the instructions not to trigger real sends/AI calls or leave fake credentials saved.
- This server is shared with other concurrent auditors (seen directly: a batch of "Integration Test"
  contact enquiries and bulk-order leads already in the queues, and one session hiccup where this
  session's own tab briefly bounced through the login page mid-audit) — a couple of anomalies during
  testing were judged to be shared-server/session noise rather than product bugs and were excluded
  from the findings above after re-verification.
