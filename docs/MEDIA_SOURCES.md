# Storefront Media Sources

Product and marketing imagery is centralized in `src/data/media/catalog.ts`.

## Policy

- **Priority 1:** [daakyka.com](https://daakyka.com) — product design collage, hospital/school uniform manufacturing, client logos, founders.
- **Priority 2:** Pexels / Unsplash IDs verified as **medical scrubs, scrub suits, or clinical uniforms** — not generic portraits or hospital equipment-only shots.
- Replace catalog URLs with `cdn.shopify.com` when live SKU photography is connected.

## daakyka.com assets in use

| Asset | Usage |
|-------|--------|
| `images/why.jpg` | Hero, product design collage, bespoke PDP gallery |
| `images/20.jpg` | Hospital uniforms, bulk orders, blog institutional |
| `images/21.jpg` | School uniforms, shop bespoke promo |
| `images/12.jpg` | Institutional showcase, insights strip |
| `owner/kamal.jpg`, `owner/dianeshree.jpg` | About page founders |
| `images/1–19.jpg` | Client trust logos |

## Catalog structure

| Export | Usage |
|--------|--------|
| `daakykaMedia.*` | Brand, founders, client logos, uniform showcase |
| `scrubMedia.*` | Product seed images (8 SKUs) + clinical lifestyle |
| `categoryMedia.*` | Shop-by-category tiles |
| `marketingMedia.*` | Hero (daakyka), mix & match, bespoke, insights |
| `blogMedia.*` | Blog hero images |
| `testimonialAvatars.*` | Review avatars (healthcare workers in scrubs) |
| `productImage(handle)` | Primary image by product handle |
| `productGallery(handle)` | 3-image gallery per SKU (PDP thumbnails) |

## Next.js images

Remote hosts in `next.config.ts`: `images.pexels.com`, `images.unsplash.com`, `cdn.shopify.com`, `daakyka.com`.

## Updating images

1. Prefer new assets from daakyka.com product photography when available.
2. For stock fallback, use [Pexels medical scrubs](https://www.pexels.com/search/medical%20scrubs/) — confirm the photo shows scrubs/uniforms.
3. Add the photo ID to `catalog.ts` with a descriptive key.
4. Map products in `productImageByHandle` or component imports.
5. Run `npm run build` to verify Next.js Image optimization.
