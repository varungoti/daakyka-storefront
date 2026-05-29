# Mix & Match Studio + OutfitAnyone + Local Hermes — Design Spec

**Date:** 29 May 2026  
**Status:** Approved — Phase 1–3 implementation in progress  
**Mockup reference:** `Source Images/ChatGPT Image May 28, 2026, 12_06_58 PM.png`  
**Staging audit:** `dogfood-output/mockup-audit/`

## Implementation status (29 May 2026)

| Item | Status |
|------|--------|
| Fix broken scrub preview (Pexels cantaloupe) | ✅ Done |
| `/mix-and-match/studio` mockup 4-column layout | ✅ Done |
| OutfitAnyone API proxy + Python service scaffold | ✅ Done |
| Favorites panel in studio | ✅ Done |
| Local Hermes agent (Fireworks router) | ✅ Done |
| Homepage hero defaults → mockup copy | ✅ Done (seed + fallbacks) |
| Variant resolution size + color | ✅ Done |
| GPU OutfitAnyone weights | 🔲 Deferred — use `services/ar-tryon` (CPU MediaPipe) |
| AR try-on studio (`/mix-and-match/studio`) | ✅ MediaPipe + OpenCV service |

---

## 1. Visual audit (staging vs mockup)

Screenshots captured 29 May 2026 from https://storefront-nu-woad.vercel.app/

| Asset | Path |
|-------|------|
| Mockup | `dogfood-output/mockup-audit/mockup-reference.png` |
| Staging homepage | `dogfood-output/mockup-audit/homepage-staging.png` |
| Staging mix-match | `dogfood-output/mockup-audit/mix-match-staging.png` |

### Critical bug (P0)

**Mix & Match preview shows cantaloupe/melon stock photo**, not scrubs. Root cause: broken Pexels ID mapping or CDN redirect in `scrubMedia.vNeckLilac` (8460152). Must fix before any OutfitAnyone work.

### Layout gaps vs mockup

| Section | Mockup | Staging today | Priority |
|---------|--------|---------------|----------|
| Hero headline | "The Future of Medical Commerce" | "Expertly Designed, Meticulously Crafted" | P1 — update default CMS copy |
| Hero image | Dual models on glowing pedestal | Single institutional collage | P1 — use daakyka + dual-model composite |
| Hero trust | 20,000+ professionals, 4.9/5, Secure Checkout | 9+ years, Pan India | P1 — align stats |
| Nav | COLLECTIONS | INSTITUTIONAL | P2 — rename or add Collections |
| Best sellers | Horizontal carousel, prominent | Present but less polished | P2 |
| Mix & Match homepage | 4-column: checklist \| 3D model \| controls \| **AI Fit Scan** | 3-column teaser, no AI panel | P1 for studio page |
| Mix & Match dedicated | All controls visible (not tabbed) | Tabbed sidebar controls | P1 for studio page |
| 3D pedestal + glow | Circular lavender platform | Flat card, drag-rotate CSS only | P1 for studio page |
| Bespoke | Dark plum waves, female model | Similar but different asset | P2 |
| Extra homepage sections | Not in mockup | Shop by category, bulk, journal, insights | P3 — keep or collapse |

---

## 2. Scope decomposition

This is **three independent subsystems**. Build in order:

```
Track A: Mockup UI alignment (homepage + studio layout)
Track B: OutfitAnyone try-on service + dedicated test page
Track C: Local Hermes agent (Fireworks model router)
```

**Track B does not depend on Track C.**  
**Track A studio page is the shell for Track B.**

---

## 3. Track A — Mockup-aligned UI (Phase 1)

### 3.1 New route: `/mix-and-match/studio` (test-only)

- `robots: noindex` until production-ready
- Feature flag: `NEXT_PUBLIC_OUTFIT_STUDIO=1`
- **Not linked from main nav** during beta; direct URL + admin link only
- Reuses mockup 4-column layout:

```
┌─────────────────┬──────────────────┬─────────────────┬─────────────────┐
│ Checklist + CTAs│ 3D Avatar Stage  │ Style selectors │ Favorites panel │
│                 │ (pedestal glow)  │ (always visible)│ + AI Fit Scan   │
└─────────────────┴──────────────────┴─────────────────┴─────────────────┘
```

### 3.2 Components to build/refactor

| Component | Action |
|-----------|--------|
| `MixMatchStudioPage` | New page shell matching mockup grid |
| `MixMatchStudioControls` | Non-tabbed; top/bottom/fabric/color/size always visible |
| `MixMatchAvatarStage` | Pedestal glow, male/female toggle, loading skeleton |
| `MixMatchFavoritesPanel` | Wishlist items applyable to current outfit |
| `AiFitScanPanel` | UI shell → triggers OutfitAnyone body preset (not body upload initially) |
| `mix-match-section.tsx` (homepage) | Restyle to mockup 4-column preview |

### 3.3 Homepage hero alignment

- Default hero CMS seed → mockup copy
- Hero image: daakyka uniform showcase + scrub lifestyle composite
- Trust stats → mockup values (configurable in admin)

### 3.4 Shopify product binding (instant preview path)

**Before OutfitAnyone GPU is ready**, use improved static compositing:

1. `getProducts()` → all Shopify/seed products
2. Map products by `productType` / tags: `top`, `bottom`, `set`
3. On style/color change → resolve variant `featuredImage.url`
4. Layer top + bottom images on avatar (CSS composite) as fallback
5. Debounce 300ms → call OutfitAnyone API when service is up

**Variant selection fix:** Match both **size AND color** from config (today: size only).

---

## 4. Track B — OutfitAnyone integration (Phase 2)

### 4.1 Reality check on [OutfitAnyone repo](https://github.com/HumanAIGC/OutfitAnyone)

The GitHub repository contains **documentation and GIFs only** — no inference server code. Official demos run on:

- [Hugging Face Spaces](https://huggingface.co/spaces) (OutfitAnyone v0.9)
- [ModelScope 魔搭](https://modelscope.cn/) (China)

**Self-host options:**

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **A. GPU Docker (HF Space clone)** | Full control, no per-call fee | Requires NVIDIA GPU server (A10/L4+), complex setup | **Recommended for production** |
| **B. Replicate / fal.ai hosted model** | Fast to integrate | Per-image cost, external dependency | Good for MVP test |
| **C. IDM-VTON / OOTDiffusion fork** | Open weights on HF | Different API than OutfitAnyone paper | Fallback if OA weights unavailable |

### 4.2 Architecture

```
┌─────────────────────┐     POST /api/outfit/try-on      ┌──────────────────────────┐
│ mix-and-match/studio│ ─────────────────────────────────►│ Next.js API route (proxy) │
│ (client)            │ ◄─────────────────────────────────│ + job queue + cache       │
└─────────────────────┘     { resultImageUrl, jobId }     └────────────┬─────────────┘
                                                                        │
                                                                        ▼
                                                          ┌──────────────────────────┐
                                                          │ outfit-service/ (Python)  │
                                                          │ FastAPI + OutfitAnyone    │
                                                          │ Port 8080 (local Docker)  │
                                                          └──────────────────────────┘
```

**New monorepo folder:** `storefront/services/outfit-anyone/`

- `Dockerfile` (CUDA base)
- `app/main.py` — FastAPI endpoints:
  - `POST /predict` — `{ avatar_id, garment_top_url, garment_bottom_url?, gender }`
  - `GET /health`
- Pre-set avatars (male/female) — aligns with OutfitAnyone HF demo policy (no user photo upload in v1)
- Redis/Postgres cache: `(avatar + top_url + bottom_url) → result_url` (24h TTL)

**Next.js proxy:** `src/app/api/outfit/try-on/route.ts`

- Validates session + rate limit (10/min)
- Fetches garment images from Shopify CDN
- Proxies to `OUTFIT_SERVICE_URL` (default `http://localhost:8080`)
- Returns base64 or R2/Vercel Blob URL

### 4.3 Client flow (instant apply)

1. User selects top style → resolve Shopify product + color variant image
2. User selects bottom → resolve bottom garment image
3. `useOutfitTryOn` hook debounces 400ms
4. Show skeleton on avatar stage
5. POST `/api/outfit/try-on` with garment URLs + gender
6. On success → replace avatar stage image
7. On failure → fallback to CSS composite + toast

### 4.4 Favorites ↔ Studio integration

Extend `WishlistProvider`:

```typescript
interface WishlistOutfit {
  topHandle: string;
  bottomHandle: string;
  color: string;
  fabric: string;
  previewUrl?: string; // cached try-on result
}
```

- **Wishlist drawer:** "Try on in Studio" button per item
- **Studio favorites panel:** Grid of heart-saved products; click applies to current config
- **Save current look:** Button stores outfit config + optional try-on preview URL to localStorage (v1) → API (v2)

No server wishlist in v1 — matches current localStorage architecture.

### 4.5 Shopify requirements

For each product/variant in Shopify Admin:

- Plain-background garment photo (ideal for try-on)
- Metafields (namespace `daakyka`):
  - `garment_type`: `top | bottom | set | jacket`
  - `gender_fit`: `male | female | unisex`
  - `mix_match_style`: `v-neck | mandarin | jogger | ...`

Storefront GraphQL query extended to fetch metafields when Shopify is connected.

---

## 5. Track C — Local Hermes agent (Phase 3)

### 5.1 Goal

Run Hermes **inside the project** — no external `HERMES_API_URL` or `HERMES_API_KEY`. Content generation via **Fireworks API** only.

### 5.2 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ services/hermes/ (Node or Python — recommend Node for reuse) │
│                                                              │
│  POST /tasks { type, mode, input }                          │
│       │                                                      │
│       ▼                                                      │
│  TaskRouter ──► model profile per task type                   │
│       │                                                      │
│       ├── seo_scan          → fireworks/llama-v3p1-70b-instruct │
│       ├── blog_draft        → fireworks/llama-v3p1-405b-instruct │
│       ├── campaign_copy     → fireworks/llama-v3p1-70b-instruct │
│       ├── competitor_scan   → fireworks/llama-v3p1-8b-instruct  │
│       └── weekly_report     → fireworks/llama-v3p1-70b-instruct │
│                                                              │
│  Output → JSON suggestions (never auto-publish)               │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ HERMES_LOCAL_URL=http://localhost:8787 (no API key)
         │
┌────────┴────────┐
│ storefront       │
│ lib/hermes/client│
└─────────────────┘
```

### 5.3 Model optimization policy

| Task type | Model tier | Rationale |
|-----------|------------|-----------|
| SEO meta, titles | 8B fast | Structured short output |
| Blog drafts, campaign copy | 70B | Quality prose |
| Competitor analysis | 8B + web scrape input | Summarization |
| Weekly growth narrative | 70B | Multi-section report |
| Hermes approval payloads | 70B | JSON schema adherence |

Env:

```env
FIREWORKS_API_KEY=fw_...
HERMES_LOCAL_URL=http://localhost:8787
HERMES_DEFAULT_MODE=SUGGEST_ONLY
# Remove need for HERMES_API_KEY
```

Update `src/lib/hermes/client.ts`:

- If `HERMES_LOCAL_URL` set → use local agent (no key)
- Else if `HERMES_API_URL` → legacy external
- Else → stub mode

### 5.4 Docker Compose addition

```yaml
services:
  hermes:
    build: ./services/hermes
    ports: ["8787:8787"]
    environment:
      - FIREWORKS_API_KEY=${FIREWORKS_API_KEY}
  outfit:
    build: ./services/outfit-anyone
    ports: ["8080:8080"]
    deploy:
      resources:
        reservations:
          devices: [{ capabilities: [gpu] }]
```

---

## 6. Implementation phases & estimates

| Phase | Deliverable | Depends on | Est. |
|-------|-------------|------------|------|
| **1a** | Fix broken scrub preview images | — | 2h |
| **1b** | `/mix-and-match/studio` mockup layout (static) | 1a | 1–2 days |
| **1c** | Homepage hero + mix section mockup alignment | 1a | 1 day |
| **1d** | Shopify variant-by-color + dynamic product mapping | Shopify creds | 1 day |
| **2a** | Wishlist ↔ studio panel | 1b | 0.5 day |
| **2b** | Outfit service scaffold + API proxy (mock responses) | 1b | 1 day |
| **2c** | GPU Docker OutfitAnyone (or Replicate MVP) | GPU host | 2–5 days |
| **2d** | Live try-on on studio page | 2b+2c | 1 day |
| **3a** | Local Hermes service + Fireworks router | — | 1–2 days |
| **3b** | Wire storefront crons to local Hermes | 3a | 0.5 day |
| **4** | Production hardening (cache, rate limits, monitoring) | all | 1–2 days |

**Recommended start:** Phase 1a → 1b → 2a (visible progress without GPU).

---

## 7. Testing strategy

| Layer | What |
|-------|------|
| Visual regression | Playwright screenshots vs `mockup-reference.png` |
| Studio E2E | Style change → preview updates (mocked API in CI) |
| Outfit API | Integration test with fixture garment URLs |
| Hermes local | Unit tests for task router + Fireworks mock |
| GPU smoke | Manual: male/female × 4 tops × 4 bottoms matrix |

---

## 8. Deployment notes

- **Studio page:** Deploy to staging with `NEXT_PUBLIC_OUTFIT_STUDIO=1`, `noindex`
- **Outfit service:** Cannot run on Vercel serverless — needs GPU VM (Railway GPU, RunPod, AWS g4dn, local dev GPU)
- **Local Hermes:** Runs on any Node host; Fireworks key in env only
- **Production cutover:** Link studio from nav after try-on latency < 8s p95

---

## 9. Open decisions (need your input)

1. **GPU hosting for OutfitAnyone:** Local dev GPU, RunPod, or Replicate for MVP?
2. **AI Fit Scan:** Mockup shows body scan — v1 uses preset avatars only (OutfitAnyone HF policy). OK?
3. **Homepage extra sections:** Keep shop-by-category/bulk/journal or strip to match mockup exactly?
4. **Collections nav:** Rename Institutional → Collections or add both?

---

## 10. Approval checklist

- [ ] Phase 1 (UI + studio page + image fixes) approved to implement
- [ ] Phase 2 GPU hosting choice confirmed
- [ ] Phase 3 local Hermes + Fireworks approved
- [ ] AI Fit Scan = preset avatars only for v1 confirmed

**Next step after approval:** Invoke `writing-plans` skill → detailed task breakdown → implement Phase 1a/1b.
