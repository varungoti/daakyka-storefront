# Deploy AR Try-On Service

CPU-based MediaPipe try-on for `/mix-and-match/studio`. First request can take ~60–90s on cold start; cached requests are fast.

## Option A — Quick staging tunnel (dev machine)

When Railway/Render credentials are not ready, wire local Docker to Vercel staging:

```bash
docker compose up -d ar-tryon
node scripts/wire-ar-staging.mjs
```

Keep the script running — the Cloudflare quick tunnel has no uptime guarantee. Use Railway or Render for production.

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
   — once this service has a public URL, anyone who finds it can burn
   your compute without one; `docker compose up -d ar-tryon` locally
   stays unauthenticated since it's never set there.
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
docker compose up -d ar-tryon
# AR_TRYON_SERVICE_URL=http://localhost:8080
```

Health: `GET /health`  
Predict: `POST /predict`

## Verify staging

```bash
TEST_BASE_URL=https://storefront-nu-woad.vercel.app npm run probe:deploy -- --staging
```

Studio: `/mix-and-match/studio` — preview should return `mode: "ar-tryon"` in network tab when AR is wired.

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
