# Storefront Media Sources

Product and marketing imagery is centralized in `src/data/media/catalog.ts`.

## Policy (updated 2026-09-20 — daakyka.com hotlinking removed)

`daakyka.com` used to be Priority 1 for brand/uniform imagery, hotlinked directly. That domain is
unreachable from this environment — DNS resolves, but every TCP connect attempt times out on every
resolved IP, both port 80 and 443, confirmed independently via curl and a .NET/PowerShell socket
test — so nothing in this app hotlinks it any more (`daakyka.com` was also removed from
`src/lib/security/image-hosts.ts`'s trusted list; see that file's comment for what was checked
before removing it).

- **Founder portraits and real client/institutional logos** (KIMS Hospitals, Pristyn Care, Delhi
  Public School, ASSA ABLOY, etc.) are real people and real trademarks — never a hardcoded hotlink,
  stock substitute, or AI-generated image. They're admin-managed `uploadOnly` slots in the image
  manifest (`about.founder.*`, `about.client.*` in `src/data/media/image-manifest.ts`), read via
  `getSiteImage`/`getSiteImages` and uploaded for real from `/admin/media`. Until uploaded, the
  about page renders a tasteful text-only treatment for that item (a monogram for a founder, a
  typographic name for a client) instead of a broken or placeholder image box — see
  `src/app/about/page.tsx` and `src/components/brand/client-logos-strip.tsx`.
- **Generic uniform/manufacturing scene photography** (`daakykaMedia.hospitalUniforms`,
  `.schoolUniforms`, `.institutionalShowcase`, `.productDesigns` in `catalog.ts`) — not real,
  identifiable people or trademarks — now falls back to a local placeholder SVG. Replace with real
  photography, or wire it into the image manifest's `hospital-scene`/`school-scene` AI-generation
  presets (already declared as `home.band.hospital`/`home.band.school`, just not yet consumed by a
  component), whichever is available first.
- **Priority for everything else:** Pexels / Unsplash IDs verified as **medical scrubs, scrub
  suits, or clinical uniforms** — not generic portraits or hospital equipment-only shots.
- Replace catalog URLs with `cdn.shopify.com` when live SKU photography is connected.

## Catalog structure

| Export | Usage |
|--------|--------|
| `daakykaMedia.*` | Generic uniform/manufacturing scene photography (local placeholders today — see Policy above). Founders and client logos are **not** here any more; see `image-manifest.ts`. |
| `scrubMedia.*` | Product seed images (8 SKUs) + clinical lifestyle |
| `categoryMedia.*` | Shop-by-category tiles |
| `marketingMedia.*` | Hero, mix & match, bespoke, insights |
| `blogMedia.*` | Blog hero images |
| `testimonialAvatars.*` | Review avatars (healthcare workers in scrubs) |
| `productImage(handle)` | Primary image by product handle |
| `productGallery(handle)` | 3-image gallery per SKU (PDP thumbnails) |

## Next.js images

Remote hosts in `next.config.ts` (sourced from `src/lib/security/image-hosts.ts`, the single
source of truth for both `images.remotePatterns` and CSP `img-src`): `images.pexels.com`,
`images.unsplash.com`, `cdn.shopify.com`, plus the R2 public host when `R2_PUBLIC_BASE_URL` is set
(it currently isn't — see [GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md)). `daakyka.com` was removed
from this list on 2026-09-20 (see Policy above) — don't re-add it without first re-verifying the
domain actually serves the paths you intend to hotlink.

## Updating images

1. For real founder/client-logo photography, upload it from `/admin/media` (`about.founder.*`,
   `about.client.*` slots) — never hotlink it, and never AI-generate it.
2. For generic scene/product photography, use [Pexels medical scrubs](https://www.pexels.com/search/medical%20scrubs/)
   or Unsplash — confirm the photo shows scrubs/uniforms — or generate it via `npm run images:generate`
   (see [IMAGES_AI.md](./IMAGES_AI.md)).
3. Add the photo ID to `catalog.ts` with a descriptive key, or the manifest slot to `image-manifest.ts`.
4. Map products in `productImageByHandle` or component imports.
5. Run `npm run typecheck` and `npm test` — see `src/data/media/catalog.test.ts` and
   `src/data/media/image-manifest.test.ts` for the invariants these are expected to hold.
