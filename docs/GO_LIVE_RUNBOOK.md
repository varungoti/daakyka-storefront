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

`NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`/`NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` only switch on a
**legacy, disconnected cart mode** (`src/lib/cart/service.ts`, `/api/cart`) that was never wired to
this app's real Prisma catalog (Shopify product GIDs vs. this app's own product ids) or to the real
order pipeline above. It is not part of checkout, not required for launch, and is slated for
removal — do not set these to "unblock" a launch.

## Phase A — Staging (1–2 hours)

### A1. Database

Any Postgres works for staging (a separate Supabase project, Neon, etc.) — it does not need to be
the same one production uses.

1. Create a **staging** Postgres database.
2. Set it as Vercel's `DATABASE_URL` env var for the Preview/staging environment (Prisma — see
   `prisma.config.ts` — only ever reads the env var literally named `DATABASE_URL`; there is no
   other name it recognizes).
3. Migrations run automatically on every deploy — see A2.

### A2. Vercel project

1. Import the repo; set **Root Directory** = `storefront`.
2. Add env vars — see [Environment variables](#environment-variables-what-is-actually-required)
   below (do **not** just copy `.env.staging.example` blindly; it lists optional integrations too).
3. Deploy the preview/staging branch. The build command (`vercel.json` → `node scripts/vercel-build.mjs`)
   runs `prisma generate`, then `prisma migrate deploy` (retried on advisory-lock timeouts), then the
   idempotent `prisma/seed.ts` (create-only — safe to run on every deploy, and it refuses to run at
   all on Vercel without a real, non-default `ADMIN_SEED_PASSWORD`), then `next build`.

```bash
# After deploy — from storefront/
npm run check:deploy-env
TEST_BASE_URL=https://YOUR-STAGING-URL.vercel.app npm run probe:deploy -- --staging
TEST_BASE_URL=https://YOUR-STAGING-URL.vercel.app npm run verify:staging -- --dogfood
```

`npm run check:deploy-env` / `npm run go-live:check` only check 5 vars (`DATABASE_URL`,
`AUTH_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_SEED_PASSWORD`) — a green run from
either does **not** mean every var `validateEnv()` requires is set. In particular neither script
checks `CREDENTIAL_ENCRYPTION_KEY`, which the app itself hard-requires in production (see below).
Don't treat a clean `check:deploy-env` as the full picture.

### A3. Staging checklist

- [ ] Admin login works; **change the seed password**
- [ ] `GET /api/health` → `{ "status": "ok" }`
- [ ] `robots.txt` disallows indexing (auto-enforced on Vercel Preview; also settable via
      `NEXT_PUBLIC_ALLOW_INDEXING=false`)
- [ ] Complete manual items in `QA_CHECKLIST.md` on the staging URL

---

## Phase B — Production database (Supabase)

Production runs on **Supabase Postgres**, connected through the **session pooler** — this is not
optional/interchangeable with the other two connection strings Supabase gives you:

| Connection | Port | IPv4? | Use it? |
|---|---|---|---|
| Direct host (`db.<project-ref>.supabase.co`) | 5432 | **No — IPv6 only** (verified: DNS returns only an AAAA record, no A record) | No — Vercel's default runtime egress is IPv4 |
| Transaction pooler | 6543 | IPv6 only | No, same reason |
| **Session pooler** (`aws-0-<region>.pooler.supabase.com`) | **5432** | **Yes** (verified: resolves to real IPv4 addresses behind an AWS ELB) | **Yes — use this one** |

Steps:

1. Get the session-pooler connection string from Supabase (Project Settings → Database →
   Connection string → **Session pooler**).
2. **Percent-encode the password** in the URL if it contains any special characters (`@`, `#`, `%`,
   `/`, etc. all need encoding, or the URL parses wrong).
3. In Vercel, set the **Production** environment variable named exactly `DATABASE_URL` (not
   `SUPABASE_DATABASE_URL` — Prisma doesn't read that name; see `prisma.config.ts`) to that string.
   This repo's local `.env` happens to keep a copy of the production value under
   `SUPABASE_DATABASE_URL` purely as a reference — that's a deliberately different name so a local
   `npm run dev`/`npm test` (which loads `.env` and always uses `DATABASE_URL`) can never point at
   production by accident. **Never copy that value into `.env`'s own `DATABASE_URL`.**
4. Production has already been migrated and seeded once using this connection string — a fresh
   deploy just re-runs the same idempotent `migrate deploy` + `seed.ts` from A2, which is safe.

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

## Phase D — Payments & integrations (when ready)

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
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` / `NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` / `SHOPIFY_WEBHOOK_SECRET` | Legacy cart mode only — see above. Leave unset. |
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

Also note: as of this writing, **Homepage Hero/Trust-Stats/Announcement, Offers, and Testimonials
have no revalidation call at all** (`src/lib/homepage/index.ts`, `src/lib/offers/index.ts`,
`src/lib/testimonials/index.ts`) and sit behind a fully static homepage — an edit to those
specifically needs a redeploy today, which is a real gap, not the SWR behavior described above.

---

## Verification commands

| Command | When |
|---------|------|
| `npm run verify:101` | Before every merge to staging/main |
| `npm run check:deploy-env` | Before promoting env vars (see the caveat in A2 — it's a partial check) |
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
