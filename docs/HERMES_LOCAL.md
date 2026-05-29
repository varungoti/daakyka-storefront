# Local Hermes Agent

Self-hosted marketing agent for DAAKYKA — **no external Hermes API key**. Uses Fireworks for LLM inference.

> **Production:** Prefer [HERMES_VERCEL.md](./HERMES_VERCEL.md) — Hermes runs inline on Vercel with `HERMES_RUNTIME_INLINE=1`.

## Run

```bash
cd services/hermes
cp ../../.env.local .env   # must include FIREWORKS_API_KEY
npm install
npm run dev
```

Or via Docker Compose from storefront root:

```bash
FIREWORKS_API_KEY=fw_... docker compose up -d hermes
```

## Storefront config

```env
HERMES_LOCAL_URL=http://localhost:8787
HERMES_DEFAULT_MODE=SUGGEST_ONLY
```

Enable in **Admin → Integrations** (Hermes toggle).

## Model routing

| Task | Fireworks model |
|------|-----------------|
| SEO scans, competitor scan | llama-v3p1-8b-instruct |
| Blog drafts, campaigns, weekly report | llama-v3p1-70b-instruct |

Tasks POST to `http://localhost:8787/tasks` with `{ type, mode, input }`.

## Health

`GET http://localhost:8787/health`
