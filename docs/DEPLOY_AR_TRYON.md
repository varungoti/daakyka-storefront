# Deploy AR Try-On Service

CPU-based MediaPipe try-on for `/mix-and-match/studio`. First request can take ~60–90s on cold start; cached requests are fast.

## Option A — Quick staging tunnel (dev machine)

When Railway/Render credentials are not ready, wire local Docker to a Vercel **Preview**:

```bash
# cloudflared must already be installed and on PATH (the script no longer downloads it)
export AR_TRYON_API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
node scripts/wire-ar-staging.mjs            # sets Preview AR_TRYON_SERVICE_URL + AR_TRYON_API_KEY
node scripts/wire-ar-staging.mjs --deploy   # same, then creates a preview deployment (a metered build)
```

The script only ever writes the **Preview** environment and never deploys to production. It
refuses to open the tunnel unless `AR_TRYON_API_KEY` is set, recreates the local container with that
key, and checks that an unauthenticated request is rejected. Keep it running: the Cloudflare quick
tunnel has no uptime guarantee. Use Railway or Render for production.

Production's `AR_TRYON_SERVICE_URL` must only ever point at a durable, authenticated service (Option B
or C below), or be unset. If it still holds an old quick-tunnel URL from an earlier run, remove it:
`npx vercel env rm AR_TRYON_SERVICE_URL production` and redeploy.

## Option B — Railway (recommended for production)

1. Log in locally: `railway login`
2. From `services/ar-tryon`:
   ```bash
   railway init
   railway up
   railway domain
   ```
3. Copy the public URL (e.g. `https://ar-tryon-production.up.railway.app`)
4. Set an API key on the Railway service too (`railway variables set AR_TRYON_API_KEY=...`)
   — the service answers 401 to every request without one (it only runs unauthenticated when
   `AR_TRYON_ALLOW_UNAUTH=1`, which is for local Docker only and must never be set on Railway).
5. In **Vercel → storefront → Environment Variables**:
   ```env
   AR_TRYON_SERVICE_URL=https://YOUR-RAILWAY-URL
   AR_TRYON_API_KEY=<same value as step 4>
   ```
6. Redeploy storefront (or wait for next deploy)

### GitHub Actions (optional)

Add `RAILWAY_TOKEN` to GitHub repo secrets. Pushes to `services/ar-tryon/**` trigger `.github/workflows/deploy-ar-tryon.yml`.

## Option C — Render

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect `varungoti/daakyka-storefront`
3. Set root to `services/ar-tryon` (uses `render.yaml`)
4. Set `AR_TRYON_API_KEY` in the Render service's environment (marked
   `sync: false` in `render.yaml`, so Render will prompt for it)
5. Deploy and copy the service URL into Vercel as `AR_TRYON_SERVICE_URL`,
   plus the same `AR_TRYON_API_KEY`

## Option D — Local Docker (dev)

```bash
# The port is bound to 127.0.0.1 only. Either run without a key (local opt-out)...
AR_TRYON_ALLOW_UNAUTH=1 docker compose up -d ar-tryon
# ...or with one (then send the same value as AR_TRYON_API_KEY to the storefront):
#   AR_TRYON_API_KEY=<random value> docker compose up -d ar-tryon
# AR_TRYON_SERVICE_URL=http://localhost:8080
```

Without either, the service answers 401 to `/predict`.

Health: `GET /health`  
Predict: `POST /predict`

## Verify staging

```bash
# a Preview deployment only: --staging requires robots.txt to disallow crawling, which production must not
TEST_BASE_URL=https://YOUR-PREVIEW-URL.vercel.app npm run probe:deploy -- --staging
```

Studio: `/mix-and-match/studio` — preview should return `mode: "ar-tryon"` in network tab when AR is wired.

The studio and `POST /api/outfit/try-on` are both off until an admin turns on the **Mix & Match** page
(setting `pages.mixMatch.enabled`, default off): the page and the endpoint answer 404. The probe treats
that as "switched off" and skips the try-on check, so a default install still passes; to exercise the
rendering path on a Preview deployment, enable the page there first, then run
`npm run probe:deploy -- --staging --write-probes` (it calls the paid rendering service, never run it on production).

## Timeouts

- Storefront proxy: **100s** (`service-client.ts`) — kept under the
  Vercel function's own limit so a slow/hung AR service still gets a
  graceful fallback response instead of Vercel killing the function
- Vercel function: **120s** (`vercel.json` → `/api/outfit/try-on`)
- Railway healthcheck: **120s** (`railway.toml`)

## Image URL allowlist

The service only fetches `top_garment_url`/`bottom_garment_url`/`avatar_url`
from hosts in `ALLOWED_IMAGE_HOSTS` (`app/compositor.py`), kept in sync with
`storefront/src/lib/security/image-hosts.ts`. Add a host to both places if a
new product image CDN is introduced.

## Security notes (F-305)

- Auth is mandatory: with no `AR_TRYON_API_KEY` the service answers 401 to every request unless
  `AR_TRYON_ALLOW_UNAUTH=1` is set, which is for local Docker behind `127.0.0.1` only. Keys are
  compared in constant time and clients only ever see a generic error.
- The base image in `services/ar-tryon/Dockerfile` is pinned by digest, so a rebuild cannot silently
  change it. Dependabot (docker ecosystem, weekly) proposes the bump; verify any bump with
  `node scripts/local-ar-ci.mjs` (builds the production image, runs the tests, smokes `/health`).
- Known, accepted limitation: `mediapipe` stays at 0.10.14, which caps `protobuf` below 5
  (CVE-2026-0994). Every mediapipe release that lifts the cap also removes the `mp.solutions.pose`
  API that `app/compositor.py` is built on, so fixing it means porting torso detection to the newer
  MediaPipe Tasks API (a separate pose-landmark model file and a different call shape) and
  re-checking garment placement by eye. Until then the exposure is a CPU/memory denial of service
  from a crafted protobuf, which this service never parses from user input; user images are only
  decoded by OpenCV/Pillow after a byte cap and a pixel-dimension check.
