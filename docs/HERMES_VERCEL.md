# Hermes on Vercel

Hermes runs **inside the storefront** on Vercel — no separate server or external Hermes API key required.

## Architecture

```
Admin UI / Cron  →  dispatchHermesTask()
                         │
         ┌───────────────┴────────────────┐
         │ HERMES_RUNTIME_INLINE=1        │ HERMES_LOCAL_URL set
         ▼                                ▼
  routeHermesTask() (in-process)    POST /api/hermes/runtime/tasks
         │                                │
         └───────────────┬────────────────┘
                         ▼
              Fireworks API (FIREWORKS_API_KEY)
```

## Vercel environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `FIREWORKS_API_KEY` | Yes (for live LLM) | Fireworks inference |
| `HERMES_RUNTIME_INLINE` | Yes | In-process routing on Vercel (recommended) |
| `HERMES_DEFAULT_MODE` | No | Default `SUGGEST_ONLY` |
| `HERMES_API_KEY` | Recommended | Secures `/api/hermes/runtime/tasks` HTTP endpoint |
| `HERMES_LOCAL_URL` | Optional | `https://YOUR-APP.vercel.app/api/hermes/runtime` for HTTP mode / external callers |

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/hermes/runtime/health` | Public |
| `POST` | `/api/hermes/runtime/tasks` | `Authorization: Bearer HERMES_API_KEY` (or `CRON_SECRET`) |

## Model routing

| Task | Fireworks model |
|------|-----------------|
| SEO scans, competitor scan | `llama-v3p1-8b-instruct` |
| Blog drafts, campaigns, weekly report | `llama-v3p1-70b-instruct` |

## Local development

**Option A — inline (matches Vercel):**

```env
HERMES_RUNTIME_INLINE=1
FIREWORKS_API_KEY=fw_...
```

**Option B — standalone Docker agent:**

```bash
FIREWORKS_API_KEY=fw_... docker compose up -d hermes
```

```env
HERMES_LOCAL_URL=http://localhost:8787
```

See also [HERMES_LOCAL.md](./HERMES_LOCAL.md) for the Docker agent.

## Safety

- Default mode: `SUGGEST_ONLY`
- All outputs land in the **approval queue** — never auto-published
- See [HERMES_SECURITY.md](./HERMES_SECURITY.md)
