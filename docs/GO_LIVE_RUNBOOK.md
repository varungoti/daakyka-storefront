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

These remote gates write data (a homepage edit, a blog draft, a queued Hermes task), so
`verify:staging` and `verify:staging:full` refuse the production store; point them at a Preview/staging
deployment. Against production use `npm run verify:staging:full -- --production-readonly` (GET-only
checks). Mix & Match, its try-on studio and Fabric Technology are switched off by default and return 404 by
design: the probe, smoke and dogfood checks expect that. If you have switched them on for that deployment,
run the gates with `CI_OPTIONAL_PAGES_ENABLED=1` so they expect the pages instead.

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
`src/lib/storage/r2-env.ts`'s `readR2Env()` accepts either set (the boot-time warning uses the same function, so it can't disagree); this repo's own `.env` in fact uses the
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
the homepage (a 200 that contains `DAAKYKA`, no noindex meta, canonical host), and `robots.txt` before declaring it live. A redirect to a Vercel login page, or a 200 that isn't this store's page, aborts instead of reporting "Live".

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
| `ERROR_WEBHOOK_URL` | Optional `https://` webhook that receives a short alert for every server error (see "Monitoring & alerting" below); unset = errors are only logged |
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

## Monitoring & alerting

What ships in the code (F-234):

- `src/instrumentation.ts` exports `onRequestError`, which calls `src/lib/monitoring/report-error.ts`
  for every server error (render, route handler, server action, proxy). Each error is written as one
  structured JSON line to stderr with `"event":"request_error"`, and Vercel keeps it with the other
  runtime logs. The line carries the path (never the query string), method, route, Next's error
  digest and a truncated message. Request headers, cookies and bodies are never read.
- If `ERROR_WEBHOOK_URL` is set to an `https://` URL, the same summary (without the stack) is also
  POSTed there as JSON with a ready-made `text` field, which Slack, Mattermost and Google Chat
  incoming webhooks accept directly (or point it at a small relay to Telegram/WhatsApp). Repeats of
  the same error are sent at most once per 5 minutes per server instance, so a crash loop cannot
  flood the channel. Leave it unset and the webhook is simply off.
- Moving to Sentry later is a drop-in: `npm i @sentry/nextjs`, `Sentry.init` in `register()`, and
  `Sentry.captureRequestError` as `onRequestError`. Nothing else in the app has to change.

What the owner still has to set up (accounts and dashboards, not code):

1. Create the webhook (for example a Slack channel's incoming webhook) and add
   `ERROR_WEBHOOK_URL` to the Vercel **Production** environment, then redeploy.
2. An external uptime monitor (UptimeRobot, Better Stack or similar) on `GET /api/health`. That
   route runs a real database query, so pooler exhaustion such as `EMAXCONNSESSION` shows up as a
   failure, not just a slow page. Do not point it at `/api/cron/*`.
3. Optionally a Vercel Log Drain with an alert on 5xx. The same drain is also what satisfies the
   180-day log retention in [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md#7-log-retention-policy-cert-in-180-days).

## Rolling back a bad deploy

1. **Roll back first, debug second.** `npx vercel rollback` (or Vercel dashboard -> Deployments ->
   the last good deployment -> Promote to Production) points the production domain at an older
   build in seconds. It does **not** rebuild, so `scripts/vercel-build.mjs` does not run: the
   database stays at whatever schema the newer build migrated it to.
2. **Therefore migrations must be backward compatible for one release** (expand, then contract):
   - Release N adds the new column or table (nullable, or with a default) and starts writing it.
   - Release N+1, only after N has been stable, stops reading the old shape.
   - Release N+2 drops or renames the old column.
   Never drop, rename or tighten (`NOT NULL`, a new unique index) something the previous release
   still uses, in the same release that stops using it. Then rolling back one build is always safe
   against the current schema.
3. **A bad migration is fixed forward.** Never edit a migration that has been applied, and never run
   `prisma migrate reset` against production. Write a new migration that corrects it, and for a
   failed one follow the `prisma migrate resolve` steps printed by `scripts/go-live.mjs`.
4. **Environment variables come back as they were.** A deployment keeps the env values it was built
   with, so rolling back also restores older values. If you rotated a secret since then, the rolled
   back build uses the OLD one; rotate again after promoting, or do not roll back past a rotation.
5. **Verify after rolling back:** `GET /api/health` is `{"status":"ok"}`, the homepage and a product
   page load, and an order request goes through (the cart and checkout are the money path).
6. Then roll forward with a fixed build; re-promote only a deployment that passed
   `node scripts/local-release.mjs`.

## Backups & restore

The production database is the Supabase project in `ap-northeast-1` (Tokyo). A backup nobody has
restored is a hope, not a backup, so:

1. **Find out what you have.** Supabase dashboard -> Database -> Backups. Note the plan and the
   tier: the Free plan has no downloadable backups, Pro has daily backups, point-in-time recovery
   (PITR) is a paid add-on. Write the answer here: `plan: ____ / backups: ____ / PITR: ____`.
   Before launch, a paid plan with at least daily backups (PITR preferred, since the store takes
   orders all day) is strongly recommended. This is an owner decision with a monthly cost.
2. **Take a manual dump before anything destructive** (a data migration, a bulk catalogue delete, a
   Supabase password or region change). Use the **session pooler** URL (port 5432, the same string
   as `MIGRATION_DATABASE_URL`), from a machine with `pg_dump` installed:

   ```bash
   pg_dump "$MIGRATION_DATABASE_URL" --format=custom --no-owner --file="daakyka-$(date +%F).dump"
   ```

   Keep the file somewhere private. It contains customer personal data; treat it like production.
3. **Restore drill (do this once, before launch, then after any schema-changing release).** Create
   a throwaway Supabase project, restore into it, and compare row counts:

   ```bash
   pg_restore --no-owner --dbname="<throwaway session pooler URL>" daakyka-YYYY-MM-DD.dump
   ```

   Then point a local run at it (never at production) and open `/admin/orders`. Delete the
   throwaway project and the dump when done. Record the date of the last successful drill here:
   `last drill: ____`.
4. **Product media is not in the database.** It lives in the Cloudflare R2 bucket `daakyka-media`
   (not public, served through `/cdn`). R2 has no automatic backup; the originals of reviewed product
   photos should also be kept outside it, in the owner's own copies.

## Function region

`vercel.json` pins every function to `hnd1` (Tokyo), next to the production database. Before this
the functions ran in `iad1` (US-East) against a Tokyo database, so every query paid a trans-Pacific
round trip (about 150 ms each) plus an extra US hop for every dynamic page. With the functions in
Tokyo, a database round trip drops to a few milliseconds.

- This is the right region for the database where it is today. **If the database ever moves to
  `ap-south-1` (Mumbai), change `regions` to `["bom1"]` in the same change.** Moving the Supabase
  project is a separate, higher-risk owner decision (new project, dump and restore, new connection
  strings); this setting only moves the functions.
- Do not add per-route `preferredRegion` exports; `vercel.json` is the single source of truth.
- Check it after a deploy: `curl -sD- -o /dev/null https://<your-domain>/api/health | grep -i x-vercel-id`
  should show `...::hnd1::...`.
- `/cdn/...` responses are edge-cached, so images served from the R2 bucket (North America) are
  barely affected by the move.

## Environment variable hygiene

The app reads only the variables named in this runbook and in `.env.local.example`; everything else
on Vercel is dead weight that widens the damage of any leak. Production and Preview functions get
every variable scoped to them, and a Preview is built from any pushed branch, so keep Preview to
what a Preview truly needs (a staging `DATABASE_URL`) and never give it production credentials.

Remove these from **both** Production and Preview. Nothing in `src/`, `prisma/` or `scripts/`
reads them (F-233):

| Variable | Why it is safe to remove |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` | The app talks to Postgres through `DATABASE_URL` only; there is no Supabase client library. `SUPABASE_SECRET_KEY` is a service-role key that bypasses row-level security. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_S3_API_ENDPOINT` | Account-scoped token and an endpoint the app deliberately derives itself from the account id (`src/lib/storage/r2.ts`). |

Then, once an admin image upload and a `/cdn/<key>` image both work with the `R2_*` names alone
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` all set in Production),
remove the duplicate `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY_ID` and
`CLOUDFLARE_SECRET_ACCESS_KEY`, and keep the `R2_*` set on **Production only** (a Preview that holds
the production bucket's keys can delete production media; see F-302 in `src/lib/storage/r2.ts`).
The `CLOUDFLARE_*` fallback in the code stays, because the local `.env` still uses those names.

```bash
npx vercel env ls production        # review first
npx vercel env rm SUPABASE_SECRET_KEY production --yes
npx vercel env rm SUPABASE_SECRET_KEY preview --yes
# ...repeat for each name above, then redeploy so running functions stop receiving them
```

Environment changes only apply to new deployments; existing preview deployments keep the old
values until they are deleted or redeployed. If preview URLs were ever shared outside the team,
also rotate the Supabase service key and revoke the Cloudflare API token.

## Verification commands

| Command | When |
|---------|------|
| `npm run verify:101` | Before every merge to staging/main. Pass `--kill-port` (or `KILL_PORT=1`) to let it stop a leftover process on its port; it refuses otherwise |
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
