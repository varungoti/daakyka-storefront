# Local Hermes Agent

Self-hosted marketing agent for DAAKYKA. Uses Fireworks for LLM inference.

> **Production:** Prefer [HERMES_VERCEL.md](./HERMES_VERCEL.md) — Hermes runs inline on Vercel with `HERMES_RUNTIME_INLINE=1`.

## Run

```bash
cd services/hermes
cp ../../.env.local .env   # must include FIREWORKS_API_KEY and HERMES_API_KEY
npm install
npm run dev
```

`POST /tasks` requires `Authorization: Bearer $HERMES_API_KEY` — set the same
value here and in the storefront's own env (it's what the storefront already
sends as `HERMES_API_KEY` when calling out to `HERMES_LOCAL_URL`). Without it,
every request gets a 401, including from the storefront itself. The server
also binds to `127.0.0.1` by default (override with `HERMES_HOST` only if you
specifically need it reachable from elsewhere).

Or via Docker Compose from storefront root:

```bash
FIREWORKS_API_KEY=fw_... HERMES_API_KEY=... docker compose up -d hermes
```

## Storefront config

```env
HERMES_LOCAL_URL=http://localhost:8787
HERMES_API_KEY=...   # must match the value the hermes service was started with
HERMES_DEFAULT_MODE=SUGGEST_ONLY
```

Enable in **Admin → Integrations** (Hermes toggle).

## Model routing

| Task | Fireworks model |
|------|-----------------|
| SEO scans, competitor scan | gpt-oss-20b |
| Blog drafts, campaigns, weekly report | gpt-oss-120b |

Tasks POST to `http://localhost:8787/tasks` with `{ type, mode, input }`.

## Health

`GET http://localhost:8787/health`
