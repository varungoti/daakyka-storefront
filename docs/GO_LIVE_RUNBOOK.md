# Go-Live Runbook — DAAKYKA Storefront

This describes how the system actually deploys today — verified against `src/lib/env.ts`
(`validateEnv()`), `prisma.config.ts`, `scripts/vercel-build.mjs`, `vercel.json`, and the
integration code itself, not assumptions carried over from an earlier plan. See
[HANDOVER.md](./HANDOVER.md) for the architecture summary and [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)
for the full go-live checklist.

## How checkout actually works (read this before touching Shopify anything)

Checkout is **Razorpay + this app's own Postgres — not Shopify.** `POST /api/checkout`
(`src/lib/orders/create-order.ts`) creates the `Order` row directly and re-prices every line from
the live `ProductVariant` table; `/api/checkout/verify` and `/api/webhooks/razorpay` confirm
payment. Full detail in [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md).

Without any Razorpay keys set, checkout doesn't fail — it falls back to an **order-request** flow
(order created as `PROCESSING`, no online payment, the team follows up manually). That fallback is
a normal, supported mode, not a broken state.

`NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`/`NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` do nothing to the
cart. `isShopifyCartMode()` (`src/lib/cart/service.ts`) is hard-coded `false` — the Storefront-API
cart route it used to call (`/api/cart`) was deleted, so there is no cart mode left for these vars
to switch on. They are not part of checkout, not required for launch, and setting them has no
effect — don't set these to "unblock" a launch.

## Phase A — Staging (1–2 hours)

### A1. Database

Any Postgres works for staging (a separate Supabase project, Neon, etc.) — it does not need to be
the same one production uses.

1. Create a **staging** Postgres database.
2. Set it as Vercel's `DATABASE_URL` env var for the Preview/staging environment. The Prisma CLI
   uses `MIGRATION_DATABASE_URL` when set, and otherwise uses `DATABASE_URL`; keep the migration
   variable unset in a simple staging setup.
3. **Migrations do *not* run automatically on Preview** (fixed post-F-229 — every Git push used to
   build a Preview that ran `prisma migrate deploy` + the seed against whatever `DATABASE_URL`
   Preview had, including, once, the *production* Supabase database). `scripts/vercel-build.mjs`
   only runs those two steps when `VERCEL_ENV === "production"`. If this staging database should
   get Preview's migrations too, set `RUN_DB_MIGRATIONS=1` on the Preview environment — see A2.

### A2. Vercel project

1. Import the repo; leave **Root Directory** = `.` — the repo root *is* this app (there is no
   nested `storefront/` folder to point at inside the Vercel project's own checkout).
2. Add env vars — see [Environment variables](#environment-variables-what-is-actually-required)
   below (do **not** just copy `.env.staging.example` blindly; it lists optional integrations too).
3. Deploy the preview/staging branch. The build command (`vercel.json` → `node scripts/vercel-build.mjs`)
   always runs `prisma generate` then `next build`. It only runs `prisma migrate deploy` (retried on
   advisory-lock timeouts) and `prisma/seed.ts` (safe to run on every deploy: admin/viewer users,
   homepage sections and settings are create-only, and real `/admin` content — blog posts, SEO
   records, segments, templates, journeys, offers — is only ever seeded once per database, so a
   deleted record never comes back on the next deploy; it also refuses to run at all on Vercel
   without a real, non-default `ADMIN_SEED_PASSWORD`) when `VERCEL_ENV === "production"` **or**
   `RUN_DB_MIGRATIONS=1` is set on this environment — set the latter on Preview if this staging
   database should track new migrations automatically.

```bash
# After deploy — from storefront/
npm run check:deploy-env
TEST_BASE_URL=https://YOUR-STAGING-URL.vercel.app npm run probe:deploy -- --staging
TEST_BASE_URL=https://YOUR-STAGING-URL.vercel.app npm run verify:staging -- --dogfood
```

`npm run check:deploy-env` / `npm run go-live:check` check `DATABASE_URL`, `AUTH_SECRET`,
`CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_SEED_PASSWORD` and `CREDENTIAL_ENCRYPTION_KEY` — but
both only read the **current shell environment**, not what's actually stored on Vercel, so a green
run only means "this shell, right now, has a complete and valid set." Pass `-- --production` (or
`npm run go-live:check -- --production`) once real production values are loaded, not the staging
defaults — a plain run checks staging rules (it wants `NEXT_PUBLIC_ALLOW_INDEXING=false`; production
mode wants the opposite). Neither script checks the Razorpay/Brevo/R2 optional integrations beyond
the `go-live:check` summary further down.

### A3. Staging checklist

- [ ] Admin login works; **change the seed password**
- [ ] `GET /api/health` → `{ "status": "ok" }`
- [ ] `robots.txt` disallows indexing (auto-enforced on Vercel Preview; also settable via
      `NEXT_PUBLIC_ALLOW_INDEXING=false`)
- [ ] Complete manual items in `QA_CHECKLIST.md` on the staging URL

---

## Phase B — Production database (Supabase)

Production runs on **Supabase Postgres**. Vercel functions use the transaction pooler; Prisma
migrations use the session pooler through `MIGRATION_DATABASE_URL`. This split was verified after
the session pooler's 15-client cap caused repeated public `/api/health` 503 responses.

| Connection | Port | IPv4? | Use it? |
|---|---|---|---|
| Direct host (`db.<project-ref>.supabase.co`) | 5432 | **No — IPv6 only** (verified: DNS returns only an AAAA record, no A record) | No — Vercel's default runtime egress is IPv4 |
| **Transaction pooler** (`aws-0-<region>.pooler.supabase.com`) | **6543** | **Yes — verified from this host** | **Vercel runtime `DATABASE_URL`** |
| Session pooler (`aws-0-<region>.pooler.supabase.com`) | 5432 | Yes | Prisma CLI migrations only, via `MIGRATION_DATABASE_URL` |

Steps:

1. Get both pooler connection strings from Supabase (Project Settings → Database → Connection string).
2. **Percent-encode the password** in the URL if it contains any special characters (`@`, `#`, `%`,
   `/`, etc. all need encoding, or the URL parses wrong).
3. In Vercel Production, set `DATABASE_URL` to the transaction-pooler URL on port 6543 with
   `pgbouncer=true` in its query string (per Supabase and Prisma's pooler guidance), and set
   `MIGRATION_DATABASE_URL` to the session-pooler URL on port 5432. The Prisma CLI uses the
   latter; the application runtime uses the former. Do not point both at the session pooler.
   This repo's local `.env` happens to keep a copy of the production value under
   `SUPABASE_DATABASE_URL` purely as a reference — that's a deliberately different name so a local
   `npm run dev`/`npm test` (which loads `.env` and always uses `DATABASE_URL`) can never point at
   production by accident. **Never copy that value into `.env`'s own `DATABASE_URL`.**
4. Production has already been migrated and seeded once — a fresh
   **production** deploy (`VERCEL_ENV === "production"`) just re-runs the same `migrate deploy` +
   `seed.ts` from A2, which is safe (see the note there: real content seeds at most once per
   database, so it won't resurrect anything already deleted from `/admin`). A Preview/branch deploy
   does not touch this database at all — see A1.

---

## Phase C — Media (Cloudflare R2)

Bucket `daakyka-media`, **not public** — no r2.dev subdomain or custom domain is enabled on it.
Images are served same-origin through this app's own `src/app/cdn/[...key]` route, which
authenticates to R2 server-side and streams the object back with a long-lived immutable
`Cache-Control` (object keys are content/UUID-addressed and never reused, so there's no cache
invalidation problem for media at all). Because of this, **`R2_PUBLIC_BASE_URL` is intentionally
left unset** — setting it would try to serve images directly from a bucket that isn't public.

Required: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (or the
`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_ACCESS_KEY_ID`/`CLOUDFLARE_SECRET_ACCESS_KEY` fallback names —
`src/lib/storage/r2.ts`'s `readR2Env()` accepts either set; this repo's own `.env` in fact uses the
`CLOUDFLARE_*` names). Without these, uploads and AI generation report a clean 503 "not configured"
rather than failing — see [IMAGES_AI.md](./IMAGES_AI.md).

---

## Phase D — Domain & DNS cutover

Do this **before** registering the Razorpay webhook in Phase E — a webhook (or a crawler, or a
customer clicking an emailed link) pointed at a host that isn't live yet just fails (F-350). Today,
`daakyka.com` is **not** attached to this Vercel project — DNS still points at the old Hostinger
site (`vercel domains ls` only lists other projects' domains; `curl -sI https://daakyka.com`
answers `200` from that old site, not this app).

1. **Attach the domain**: `vercel domains add daakyka.com` (and `vercel domains add www.daakyka.com`)
   on the `storefront` project. Vercel then tells you the exact records to set — they don't change
   often, but confirm them there rather than trusting the table below blindly.
2. **At the DNS host (currently Hostinger)**, set:

   | Record | Type | Value | Notes |
   |---|---|---|---|
   | `daakyka.com` (apex) | `A` | shown by `vercel domains add` / the Project → Domains page (at the time of writing, `76.76.21.21`) | Use an `ALIAS`/`ANAME` record instead if the registrar supports one and prefers it over a bare `A` — Vercel's own instructions always take precedence over the value cached here |
   | `www.daakyka.com` | `CNAME` | `cname.vercel-dns.com` | |
   | `daakyka.com` `MX` | *(leave as-is)* | `mx1.hostinger.com` / `mx2.hostinger.com` | Do **not** touch — mail keeps flowing through Hostinger regardless of where the web traffic points |
   | `daakyka.com` `TXT` (SPF) | *(leave as-is, then extend)* | existing `v=spf1 include:_spf.mail.hostinger.com ~all`, plus `include:` Brevo's SPF host once authenticated below | Removing the Hostinger include breaks existing mail; only add to it |
   | `hostingermail-a._domainkey` | *(leave as-is)* | existing key | Existing Hostinger mail DKIM — untouched |

3. **Authenticate the sending domain in Brevo** (Brevo → Senders, Domains & Dedicated IPs →
   Domains → Authenticate a domain) so `noreply@daakyka.com` mail passes DKIM/DMARC alignment —
   without this, Brevo signs with its own shared domain instead, which does not align with the
   `daakyka.com` `From:` address. Brevo generates the exact records for this account (they are
   unique per account — this doc can't state them, only where to get them):
   - A domain-ownership `TXT` (`brevo-code=...`) at the apex.
   - Two DKIM `CNAME` records, typically `brevo1._domainkey`/`brevo2._domainkey` (or similar) →
     the targets Brevo's dashboard shows.
   - Optionally, a dedicated SPF-include host to add to the `TXT` record above.
   Also add/relax a `_dmarc.daakyka.com` `TXT` record (currently `v=DMARC1; p=none`) to
   `v=DMARC1; p=none; rua=mailto:<an address you monitor>` once DKIM/SPF alignment is confirmed
   working, so a misconfiguration surfaces as a report instead of silent spam-folder placement.
4. **Verify before moving on**: `dig +short daakyka.com A` resolves to Vercel's IP, `curl -sI
   https://daakyka.com` answers `200` from *this app* (check for `DAAKYKA` in the body, not the old
   site), and SSL is issued (Vercel does this automatically once DNS resolves).
5. Only then move to Phase E and register the Razorpay webhook, and update `NEXT_PUBLIC_SITE_URL`
   to `https://daakyka.com` (see [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) §1).

---

## Phase E — Payments & integrations (when ready)

| Integration | How | Doc |
|---|---|---|
| Razorpay (checkout) | Env vars `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` (all three or none — see below), **or** entered by an admin at `/admin/integrations` after deploy (encrypted at rest, no redeploy needed) | [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md) |
| Brevo (email) | `BREVO_API_KEY` + `BREVO_FROM_EMAIL`, **or** via `/admin/integrations` | — |
| WATI (WhatsApp) | `WATI_API_KEY`, `WATI_API_URL` | `ENGAGEMENT_SETUP.md` |
| Cron jobs | `CRON_SECRET` (required — protects every `/api/cron/*` route) | `vercel.json` |

A value entered through `/admin/integrations` always wins over the env var for the same provider
(`src/lib/integrations/credential-store.ts`) — either path works, and you can start with env vars
and move to admin-managed keys later without a code change.

Test the real flow after setting keys: place an order → Razorpay Checkout.js → `/api/checkout/verify`
→ `/admin/orders` → post-purchase journey.

---

## Go-live with scripts/go-live.mjs

`scripts/go-live.mjs` automates Phases B and E's env-push + migrate + deploy sequence (not Phase C,
D or the rest of E's third-party dashboard steps — see "What it does NOT do" below). Run it from
`storefront/` with the production values in `.env` (`SUPABASE_DATABASE_URL`, `ADMIN_SEED_PASSWORD`,
`CREDENTIAL_ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, and optionally
`OPENAI_API_KEY`/the R2 or `CLOUDFLARE_*` trio):

```bash
node scripts/go-live.mjs                  # dry run (the default) — shows the exact plan, no writes
node scripts/go-live.mjs --yes            # actually go live: migrate -> push env -> deploy -> smoke
```

**Flags:**

| Flag | Effect |
|---|---|
| `--yes` | Required to actually change anything — every other invocation is a dry run |
| `--skip-env` | Skip pushing env vars to Vercel (already correct there) |
| `--skip-migrate` | Skip the `prisma migrate deploy` step (already applied) |
| `--allow-noindex` | Acknowledge a deliberate soft launch — turns the noindex/robots-disallow checks (preflight and smoke) from an abort into a warning. Never sets or removes `NEXT_PUBLIC_ALLOW_INDEXING` itself |
| `--allow-non-pooler-db` | Skip the session-pooler hostname/port check on `SUPABASE_DATABASE_URL` — only for a deliberately different setup (e.g. a non-Supabase provider) |

**What it does:** preflight-validates `.env` (including running the same mapping/validation
`scripts/push-env-to-vercel.mjs` uses, so a problem there aborts *before* anything is written —
see F-346), migrates the production database directly (proving `SUPABASE_DATABASE_URL` actually
connects before anything reaches Vercel — see F-352), pushes env vars with `vercel env add --force`
(safe to re-run — see F-345), deploys with `vercel --prod`, then resolves the real production
hostname via `vercel inspect --format=json` (preferring a custom domain) and checks `/api/health`,
the homepage (noindex meta, canonical host), and `robots.txt` before declaring it live.

**What it does NOT do** — these are separate, manual (Phase D/E) steps:

- Attach `daakyka.com` to the Vercel project or touch DNS (Phase D)
- Set up R2/Cloudflare (Phase C), or Brevo/WATI (Phase E) — it only pushes the env vars for
  R2/OpenAI if they're already in `.env`
- Register the Razorpay webhook, or set `RAZORPAY_*` at all (set those via `/admin/integrations`
  or push them by hand — see Phase E above)
- Remove a leftover `NEXT_PUBLIC_ALLOW_INDEXING` from Vercel Production — it detects one and
  aborts (or warns, with `--allow-noindex`) with the exact `vercel env rm` command to run
- Set `DB_POOL_MAX`, `HERMES_*`, `FIREWORKS_API_KEY`, or any Shopify var — none of these are pushed

On failure it prints which stages already completed (env pushed / migrations applied / deployed)
before the failure, plus a specific recovery hint — a `prisma migrate resolve` pointer for a failed
migration, or a `vercel rollback` suggestion once the new code is already live.

---

## Environment variables — what is actually required

Derived from `src/lib/env.ts`'s `validateEnv()` (which only hard-fails on a real Vercel Production
deploy — `VERCEL_ENV === "production"` — or locally with `ENFORCE_PRODUCTION_ENV=1`; everywhere
else these are warnings) and `.env.local.example`/`.env.staging.example`.

**Hard-required — the build/boot throws without these in production:**

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | Postgres URL (not `file:`) |
| `AUTH_SECRET` | ≥ 32 characters |
| `CREDENTIAL_ENCRYPTION_KEY` | Decodes to exactly 32 bytes, base64 or hex — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Root key for `/admin/integrations` credential encryption; not itself admin-editable. |
| `CRON_SECRET` | Any value — protects `/api/cron/*` |
| `ADMIN_SEED_PASSWORD` | ≥ 12 characters, not a known default (see `src/lib/auth/seed-defaults.ts`) |
| `NEXT_PUBLIC_SITE_URL` | Must start with `https://` — also controls whether the admin session cookie is marked `Secure` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Not individually required, but **all-or-nothing**: set one and boot throws until all three are set |
| `BREVO_FROM_EMAIL` | Required only if `BREVO_API_KEY` is set |

**Optional — feature degrades gracefully (warns, doesn't fail) without these:**

| Variable | Effect if unset |
|---|---|
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` (or `CLOUDFLARE_*` equivalents) | Upload/AI-generated media returns 503 "not configured" |
| `R2_PUBLIC_BASE_URL` | Leave unset — see Phase C above. Only set this if the bucket is ever made public. |
| `OPENAI_API_KEY` | AI image generation returns 503 "not configured" |
| `OPENAI_IMAGE_MODEL` | Defaults to the current model in `src/lib/ai/image-generation.ts` |
| `AI_IMAGE_DAILY_LIMIT` | Defaults to 50 generations/day, site-wide — see [IMAGES_AI.md](./IMAGES_AI.md) |
| `DB_POOL_MAX` | Defaults to 5 — kept deliberately small per serverless-function instance; raise only if you also move off a connection pooler |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` / `NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` / `SHOPIFY_WEBHOOK_SECRET` | No effect on the cart — see above. Leave unset. |
| `WATI_API_KEY` / `WATI_API_URL` | WhatsApp journeys stay disabled |
| `HERMES_*` / `FIREWORKS_API_KEY` | Hermes agent runtime stays disabled |
| `NEXT_PUBLIC_ALLOW_INDEXING` | Staging-only; forces `noindex` regardless of environment |

---

## A note on caching — don't mistake SWR for a broken cache during QA

Every admin write that's wired to the cache (products, categories, settings, site images, size
charts, credentials, reviews) calls `revalidateTag(tag, "max")`. `"max"` is Next 16's recommended
profile: it serves **one stale response on the very next request** after the write while
regenerating in the background — true freshness lands on the request *after that one*. If a QA
reload right after saving still shows the old value, reload once more before assuming the cache is
broken; that single-stale-request behavior is expected, not a defect.

Homepage Hero/Trust-Stats/Announcement, Offers, and Testimonials (`src/lib/homepage/index.ts`,
`src/lib/offers/index.ts`, `src/lib/testimonials/index.ts`) now follow the same `revalidateTag(tag,
"max")` pattern — an edit to those shows up the same way (one stale response, then fresh), and does
**not** need a redeploy.

---

## Verification commands

| Command | When |
|---------|------|
| `npm run verify:101` | Before every merge to staging/main |
| `npm run check:deploy-env -- --production` | Before promoting env vars — checks the current shell, not Vercel itself; see the caveat in A2 |
| `npm run probe:deploy -- --staging` | After staging deploy |
| `npm run verify:staging -- --dogfood` | Full remote QA |

---

## Handover

| Audience | Document |
|----------|----------|
| Developer | `HANDOVER.md`, `COMPLETION_STATUS.md` |
| Admin user | `ADMIN_GUIDE.md` |
| Marketing/SEO | `SEO_GUIDE.md` |
| Launch owner | `LAUNCH_CHECKLIST.md` |

**Support:** `varungoti@gmail.com` (test seed) — swap via `docs/ADMIN_CREDENTIALS.md` before client go-live.
