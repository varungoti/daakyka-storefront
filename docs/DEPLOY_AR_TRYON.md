# Deploy AR Try-On Service

CPU-based MediaPipe try-on for `/mix-and-match/studio`. First request can take ~60–90s on cold start; cached requests are fast.

## Option A — Railway (recommended)

1. Log in locally: `railway login`
2. From `services/ar-tryon`:
   ```bash
   railway init
   railway up
   railway domain
   ```
3. Copy the public URL (e.g. `https://ar-tryon-production.up.railway.app`)
4. In **Vercel → storefront → Environment Variables**:
   ```env
   AR_TRYON_SERVICE_URL=https://YOUR-RAILWAY-URL
   ```
5. Redeploy storefront (or wait for next deploy)

### GitHub Actions (optional)

Add `RAILWAY_TOKEN` to GitHub repo secrets. Pushes to `services/ar-tryon/**` trigger `.github/workflows/deploy-ar-tryon.yml`.

## Option B — Render

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect `varungoti/daakyka-storefront`
3. Set root to `services/ar-tryon` (uses `render.yaml`)
4. Deploy and copy the service URL into Vercel as `AR_TRYON_SERVICE_URL`

## Option C — Local Docker (dev)

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

- Storefront proxy: **120s** (`service-client.ts`)
- Vercel function: **120s** (`vercel.json` → `/api/outfit/try-on`)
- Railway healthcheck: **120s** (`railway.toml`)
