# Site Controls

Site-wide, database-backed toggles and content settings, editable from `/admin/site-controls`
without a code deploy. Source: `src/lib/settings/index.ts` (the `SiteSetting` model and all
read/write helpers) and `src/app/admin/(panel)/site-controls/page.tsx`.

## How it works

Every setting has a **key** (`SettingKey`), a compile-time **value type**
(`SettingValueMap`), a runtime **zod schema** (`settingSchemas`) that validates both what's read
back from the DB and what an admin submits, and a hard-coded **default**
(`settingDefaults`) used whenever no row exists yet, the DB is unreachable, or a stored value fails
validation — settings reads never throw and never crash a page.

- `getSetting(key)` — cached per-key via Next's data cache (`unstable_cache`, tag `"settings"`),
  with a live DB fallback if called outside a Next server context (scripts, tests).
- `setSetting(key, value, userId)` — validates against the zod schema, upserts the
  `SiteSetting` row, writes an audit log entry (`logAuditEvent`, entity `site_setting`), and calls
  `revalidateTag("settings")` so every cached reader picks up the new value (the admin page's own
  copy says "Changes apply within a few minutes" to set expectations, though revalidation is
  usually much faster).
- `PATCH /api/admin/settings/[key]` (requires `settings:manage` — see [ROLES.md](./ROLES.md)) is
  the only write path; it 404s on an unknown key and 400s on a value that fails the key's schema.
- `isPageEnabled("fabricTech" | "mixMatch")` and `isSaleEnabled()` are thin, commonly-used wrappers
  around `getSetting()` for the two page-visibility keys and the sale-section key.

## Every setting key that currently exists

| Key | Type / constraint | Default | What it gates |
|---|---|---|---|
| `pages.fabricTech.enabled` | boolean | `false` | Whether the Fabric Technology page (`/fabric-technology`, `/fabric-technology/[slug]`) is reachable, and whether it appears in navigation, the footer, `/guides`, `/shop`, `/our-story`, `/science-of-the-scrub`, `/size-guide`, `/collections/[handle]` (redirects that shop link away if disabled), sitemap.xml, and the SEO audit tool |
| `pages.mixMatch.enabled` | boolean | `false` | Whether Mix & Match (`/mix-and-match`, `/mix-and-match/studio`) is reachable, and its appearance in navigation, footer, `/guides`, `/shop`, `/our-story`, `/size-guide`, `/collections/[handle]`, sitemap.xml, and the SEO audit tool |
| `sale.enabled` | boolean | `true` | Whether the `/sale` page renders (redirects/404s when off — see `src/app/sale/page.tsx`), and whether the Sale link appears in nav/footer, the homepage (`src/app/page.tsx`), sitemap.xml, and the SEO audit tool |
| `header.bulkCta.enabled` | boolean | `true` | The "Bulk Order" call-to-action shown in the site header |
| `announcement.messages` | `string[]`, 1–10 items, each 1–200 chars | brand's default announcement list (`src/data/brand.ts`) | The rotating announcement bar text shown site-wide |
| `shipping.flatRate` | number, 0–100,000 | `99` | The flat shipping fee shown/applied at checkout when the order is under the free-shipping threshold |
| `shipping.freeAbove` | number, 0–10,000,000 | `8000` | The order subtotal above which shipping becomes free |
| `contact.phone` | string, 6–30 chars | seeded brand phone number | Displayed phone number (footer, contact page, etc.) |
| `contact.whatsapp` | string, 6–30 chars | seeded brand phone number | Displayed/linked WhatsApp number |
| `contact.email` | string, valid email, ≤200 chars | seeded brand email | Displayed contact email |
| `contact.address` | string, 5–500 chars | seeded brand address | Displayed postal address |

There is currently **no** homepage section order/visibility setting and **no** generic
"enable/disable arbitrary page" mechanism beyond the two page keys above — `pages.fabricTech.enabled`
and `pages.mixMatch.enabled` are the only two content pages wired to a toggle. If a future plan
assumed more page toggles or a homepage section reorder control, that hasn't been built yet; this
doc reflects only what's in `SettingValueMap` today.

## Where each gate is actually checked

`isPageEnabled()` / `isSaleEnabled()` call sites (grep for them if this list goes stale):

- `src/app/layout.tsx` — root layout reads all three (`fabricTech`, `mixMatch`, `sale`) once per
  request to drive nav/footer visibility everywhere.
- `src/app/fabric-technology/page.tsx`, `src/app/fabric-technology/[slug]/page.tsx`,
  `src/app/mix-and-match/page.tsx`, `src/app/mix-and-match/studio/page.tsx` — each page itself
  checks its own flag and blocks access (see each file for the exact not-found/redirect behavior)
  when disabled, so the toggle can't be bypassed by navigating to the URL directly.
- `src/app/sale/page.tsx` — checks `isSaleEnabled()` directly.
- `src/app/page.tsx` (homepage) — checks `isSaleEnabled()` to decide whether to render the sale
  section.
- `src/app/collections/[handle]/page.tsx` — redirects a shop-by-category link away from
  `/fabric-technology` or `/mix-and-match` if the corresponding page is disabled.
- `src/app/shop/page.tsx`, `src/app/guides/page.tsx`, `src/app/guides/[slug]/page.tsx`,
  `src/app/our-story/page.tsx`, `src/app/science-of-the-scrub/page.tsx`,
  `src/app/size-guide/page.tsx` — each conditionally shows/hides links to the two gated pages.
- `src/lib/navigation/get-navigation.ts`, `src/lib/navigation/get-footer-links.ts` — build the
  header/footer nav trees, filtering out gated entries when their toggle is off.
- `src/app/sitemap.ts` — excludes gated pages' URLs from `sitemap.xml` when disabled.
- `src/lib/seo/audit.ts` — the `/admin/seo` audit tool skips gated pages so they don't show up as
  "missing" metadata issues.

## Changing settings from `/admin/site-controls`

Requires `settings:manage` (`SUPER_ADMIN`, `STORE_OWNER`, or `MARKETING_ADMIN` — see
[ROLES.md](./ROLES.md); `MARKETING_ADMIN`'s access here is intended for the sale/announcement
toggles specifically, not full operational control of the site).

1. **Pages & sections** — four toggle switches (`SiteSettingToggle`,
   `src/components/admin/site-setting-toggle.tsx`): Fabric Technology page, Mix & Match page, Sale
   section, and Header Bulk Order CTA. Each flips a boolean via
   `PATCH /api/admin/settings/[key]` immediately on click.
2. **Content** (`src/components/admin/site-controls-editors.tsx`):
   - **AnnouncementEditor** — add/remove/reorder the rotating announcement messages (1–10 of them,
     each up to 200 characters).
   - **ContactEditor** — phone, WhatsApp, email, and address shown across the site.
   - **ShippingEditor** — the flat shipping rate and the free-shipping threshold.

Every change goes through the same `settingSchemas` validation as the API route, so a rejected
value (e.g. a malformed email, or an announcement list with more than 10 entries) fails with a 400
before anything is written, and every successful save is recorded in the audit log
(`entity: "site_setting"`, visible at `/admin/audit-logs`) with the new value.
