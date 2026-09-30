# AI Image Generation

OpenAI-generated imagery for product photos and site images, stored in Cloudflare R2 alongside
regular uploads. Source: `src/lib/ai/image-generation.ts`, `src/lib/ai/prompt-presets.ts`,
`src/lib/storage/r2.ts`, `src/data/media/image-manifest.ts`,
`src/app/api/admin/media/generate/route.ts`.

## Environment variables

| Variable | Purpose | Default if unset |
|---|---|---|
| `OPENAI_API_KEY` | Auth for the OpenAI Images API | none — generation returns 503 "not configured" |
| `OPENAI_IMAGE_MODEL` | Overrides the image model id | `gpt-image-2.5-sunburst` |
| `AI_IMAGE_DAILY_LIMIT` | Max AI images generated per UTC day, site-wide | `50` |
| `R2_ACCOUNT_ID` | Cloudflare account id for R2 | none — storage returns 503 "not configured" |
| `R2_ACCESS_KEY_ID` | R2 S3-compatible access key | — |
| `R2_SECRET_ACCESS_KEY` | R2 S3-compatible secret key | — |
| `R2_BUCKET` | R2 bucket name | — |
| `R2_PUBLIC_BASE_URL` | Optional public bucket/custom domain URL | Unset: private objects are served through same-origin `/cdn/...` |

The account/key/secret settings also accept the matching `CLOUDFLARE_*` aliases. Verify each
deployment's actual environment instead of inferring readiness from a local example file. The
production bucket is private, so leave `R2_PUBLIC_BASE_URL` unset unless a public domain is
intentionally configured.

## Reviewed ChatGPT Images catalog backfill

The ChatGPT Images backfill is separate from the admin generation API. Its reviewed source-linked
manifest is `src/data/media/generated-product-views.json`. Each row records its existing
catalog reference key, product, target colour, distinct view, WebP content hash, and AI disclosure.
Most references are the exact product colour. For a target colour with no catalog photo, an
optional `referenceColor` names the same product's different-colour source, and the generated
image is visibly labelled as an AI colour interpretation requiring seller verification. The local
preparation tools under `scripts/prepare-product-image-references.mjs`,
`scripts/download-imagegen-references.mjs`, `scripts/prepare-reviewed-imagegen-batch.mjs`, and
`scripts/upload-reviewed-product-images.mjs` keep generated PNGs in ignored `dogfood-output` and
upload only inspected, approved results to private R2. Production builds apply the manifest after
Prisma migrations and the seed through `scripts/sync-generated-product-images.ts`; the sync refuses
an image when its reference no longer belongs to that exact product and declared source colour,
and a persistent marker
prevents a later deploy from restoring a photo an admin removed. Run
`node scripts/audit-generated-product-manifest.mjs` before deployment to check every source link and
uploaded CDN response.

These images are **representative AI illustrations**. They are shown with a size-verification notice
and do not count as verified size photography until a merchant checks that the design is the same
across the listed sizes or attaches exact-size photos in the product editor. A sibling-colour
reference is used only to generate a labelled interpretation, never displayed as if it were a
photo of the target colour.

## Daily generation cap

`getDailyLimit()` reads `AI_IMAGE_DAILY_LIMIT` (defaults to 50) and `generateImage()`
(`src/lib/ai/image-generation.ts`) enforces it **before** calling OpenAI: it counts
`MediaAsset` rows with `source: AI` created since UTC midnight
(`countAiImagesGeneratedToday()`) and throws `DailyLimitReachedError` if the count is already at
or above the limit, so a request that would exceed the cap never spends OpenAI quota. The API
route (`POST /api/admin/media/generate`) turns that into a **429** response, which the admin UI
surfaces as "Daily AI image limit reached — try again tomorrow." The cap is site-wide (not
per-admin, per-role, or per-product) and resets at a fixed UTC-midnight instant regardless of
server timezone.

## Generating an image (admin UI)

Two places call the same `POST /api/admin/media/generate` route (requires `ai:generate` — see
[ROLES.md](./ROLES.md); rate-limited to 20 requests/minute):

1. **Per-product, from the product editor** — the Images section of `/admin/products/[id]`
   (`ProductImageGallery`, `src/components/admin/product-image-gallery.tsx`) has a "Generate with
   AI" panel: an optional prompt override textarea (leave blank to auto-build a prompt from the
   product's name, category, gender, and fabric), a variation count (1–4), and a **Generate**
   button. Each variation is a separate API call using the `product` preset and `aspect: "square"`.
   Results appear as a picker grid of candidates — toggle which ones you want, then "Add selected
   to gallery" attaches them as real `ProductImage` rows via `POST /api/admin/products/[id]/images`.
   A 503 shows "AI image generation isn't configured yet — ask an admin to set OPENAI_API_KEY."; a
   429 shows the daily-limit message; any other failure shows "Generation failed for one or more
   variations."
2. **Site images, from the Media Library** — `/admin/media` (`SiteImagesGrid`,
   `src/components/admin/site-images-grid.tsx`) shows one card per slot declared in
   `IMAGE_MANIFEST` (`src/data/media/image-manifest.ts`) plus dynamically generated slots for every
   active category (`category.{slug}`) and blog post (`blog.post.{slug}`). Each card shows its
   current image (or a neutral placeholder SVG with a "Not generated yet" badge) with **Generate**
   and **Replace** actions scoped to that specific `slot`, `preset`, `aspect`, and pre-filled
   `fields` from the manifest entry.

Every generated image is processed and stored exactly like an upload (via `saveMediaAsset()`), and
its `prompt` and `model` are recorded on the `MediaAsset` row. Every successful generation is also
audit-logged (`logAuditEvent`, entity `media_asset`) with the preset, model, and usage.

## Prompt presets (`src/lib/ai/prompt-presets.ts`)

`buildPrompt(preset, fields)` is a pure function — no network calls — that turns a preset + field
values into the final prompt text sent to OpenAI. Every preset appends a shared `STYLE_GUIDE`
(clean, bright, photorealistic, no text/logos/watermarks) and `BRAND_CONTEXT` (DAAKYKA, Hyderabad,
plum/purple/yellow brand colours used subtly, never as overlays or printed text).

| Preset | Used for |
|---|---|
| `product` | Product photography — garment on a model or flat-lay, clean studio background. Fields: `name`, `color`, `category`, `gender`, `fabric` |
| `category-tile` | Square shop-by-category grid tile |
| `hero-banner` | Wide homepage hero, with open space reserved for overlay text |
| `hospital-scene` | Staff in scrubs/lab coats/gowns in a clinical setting |
| `school-scene` | Students in uniforms — **kids-safety guarded**, see below |
| `kids-scene` | Kids wear, playful setting — **kids-safety guarded** |
| `blog` | Editorial cover image for a blog post, magazine-style with headline space |
| `avatar` | Generic, non-identifiable placeholder profile picture |
| `how-to-measure` | Instructional measurement diagram for the size guide |

`school-scene` and `kids-scene` additionally inject a `KIDS_SAFETY_GUIDE` clause: generic,
non-identifiable children only, no recognizable faces or close-up portraits, medium/wide shots
only, fully modest age-appropriate clothing. This is baked into the prompt text itself, not an
after-the-fact filter — there is no separate moderation pass on the output image beyond whatever
OpenAI's own generation safety applies.

`sizeForAspect(aspect)` maps `"square"` → `1024x1024`, `"portrait"` → `1024x1536`, `"landscape"` →
`1536x1024`. The image manifest also has a display-only `"wide"` aspect (ultra-wide hero banners)
that `toGenerationAspect()` maps down to `"landscape"` before it's ever sent to the generation API,
since there's no wider size the API itself supports.

## Regenerating / replacing an image

From `/admin/media`, each Site Images card's **Replace** action lets you either upload a new file
or generate a new AI image for that exact `slot` — it doesn't create a duplicate row, it swaps out
what `getSiteImage(slot)` returns for that slot going forward. Product images are managed instead
from the product editor's gallery (upload, generate, reorder, retag colour, or remove — see
[ADMIN_CATALOG_GUIDE.md](./ADMIN_CATALOG_GUIDE.md)); there is no single global "regenerate all"
action for product images.

## Bulk / scripted generation

`scripts/generate-images.ts` (Phase E3) is the batch counterpart to the per-product/per-slot admin
buttons above — same `generateImage`/`saveMediaAsset` pipeline, driven over every image-needing row
in one run instead of clicking through each one. Run it with:

```bash
npm run images:generate -- [--dry-run] [--only=slots|products|categories] [--limit=N] [--yes]
```

- **What it fills in**: every AI-eligible manifest slot from `src/data/media/image-manifest.ts` without a
  `MediaAsset` (never `uploadOnly` portraits, real process photos, or client logos), every `Category` missing an image, and every `Product` with zero `ProductImage`
  rows (one image per distinct colour, capped at `MAX_COLORS_PER_PRODUCT` = 3, to bound cost on
  products with long colourways).
- **`--dry-run`**: lists every job (slot/product/category and the exact prompt it would use) and
  the estimated cost, without calling OpenAI or writing anything — works with zero credentials
  configured, so it's safe to run any time to see what's outstanding.
- **`--only=slots|products|categories`**: restricts a run to one group.
- **`--limit=N`**: caps the number of generation calls in a single run — use this for a small
  style-approval sample before committing to a full run.
- **`--yes`**: required to actually call the API and write results; without it (and without
  `--dry-run`) the script only prints the plan and estimated cost, same as a dry run, then stops.
  This is also the point where it checks `isImageGenerationConfigured()`/`isR2Configured()` and
  exits with a friendly message naming the exact missing env vars if either isn't set — it never
  gets partway through a real run on incomplete config.
- **Cost estimate**: `ESTIMATED_COST_PER_IMAGE_USD` in the script is a placeholder — verify the
  real current figure at [platform.openai.com/pricing](https://platform.openai.com/pricing) before
  relying on it for budgeting. The OpenAI SDK's response doesn't currently surface per-request
  usage through the existing `generateImage()` wrapper, so the run report's `actualCostUsd` is
  `null` rather than a fabricated number.
- **Resumable**: re-running the script only targets rows that still lack an image, so an
  interrupted or partial run can simply be invoked again.
- **Run report**: written to `dogfood-output/image-run.json` after a real (`--yes`) run — what was
  generated, what failed, and timestamps.

The batch path needs a configured OpenAI image key and the same R2 credentials as the admin
upload flow; verify them in the environment where the command will run.

## Storage (Cloudflare R2)

`src/lib/storage/r2.ts` wraps the S3-compatible R2 API (`@aws-sdk/client-s3`). `uploadObject()` and
`deleteObject()` require the four account/key/secret/bucket settings (`readR2Env()` accepts the
`CLOUDFLARE_*` aliases and returns `null` if any are missing). This is shared by AI-generated and
manually uploaded images. `publicUrlForKey()` uses `R2_PUBLIC_BASE_URL` when configured, and
otherwise serves private objects through `/cdn/[...key]`. A presigned-direct-upload helper
(`getPresignedUploadUrl()`) exists in the module but isn't wired to any admin route yet — uploads
currently transit the Next.js server function rather than going straight from the browser to R2.
