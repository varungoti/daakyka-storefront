# Admin Catalog Guide

How to add, edit, and import products from `/admin/products`. Everything below reflects the
current admin UI and API (`src/app/admin/(panel)/products/**`, `src/components/admin/product-*.tsx`,
`src/lib/catalog/*`) — not a design doc.

## Adding a product in under 2 minutes

1. Go to `/admin/products` → **New Product** (requires `products:manage`).
2. **Basics** — Name and Slug. The slug auto-fills from the name (`slugify()`) until you edit it
   directly; a debounced check against `GET /api/admin/products/check-slug` shows
   Checking…/Available/Already in use next to the field. Short description and full description
   are optional.
3. **Category** — pick from the flattened category tree (indented by depth). "+ New category"
   opens `/admin/categories/new` in a new tab if you need one that doesn't exist yet.
4. **Pricing** — Price (INR) is required and must be greater than 0. Compare-at price is optional
   but must be **greater than** the price — the form blocks saving otherwise ("Compare-at price
   must be greater than the price.") and it's what drives the Sale badge on the storefront.
5. **Variants** — pick one or more size presets (Adult scrubs XS–3XL, Kids by age, School by chest
   20–44, Linens) and/or type a custom size, then pick colours from the swatch grid (or add a
   custom name + hex) and click **Generate variants (N)**. This builds the full size × colour
   matrix via `generateVariantMatrix()` (`src/lib/catalog/product-validation.ts`), each row getting
   an auto-generated SKU in the form `DK-{CATEGORYCODE}-{SLUG}-{SIZE}-{COLOR}` (e.g.
   `DK-SCRSET-unisex-scrub-set-M-NAVY`). Generating again only adds rows for size/colour pairs not
   already present — it won't duplicate or wipe out manual edits. Stock defaults to 0 per row; use
   "Apply stock to all" to bulk-set it, or edit rows inline (stock, price override, active
   checkbox, or regenerate the SKU). A duplicate (size, colour) pair is flagged inline before you
   can save it.
6. **Images** — only available once the product has been saved at least once (a brand-new product
   has no id for a `ProductImage` to reference yet — the section shows "Save the product as a draft
   first to add images" until then). Two ways to add images:
   - **Upload images** — multipart upload to `POST /api/admin/media`, `image/png|jpeg|webp|avif`.
     Returns **503** with "Image storage isn't configured yet" if Cloudflare R2 credentials aren't
     set (see [IMAGES_AI.md](./IMAGES_AI.md)).
   - **Generate with AI** — optional prompt override (leave blank to auto-build a prompt from the
     product's name, category, gender, and fabric), 1–4 variations, then **Generate**. Requires
     `ai:generate`. Returns **503** if `OPENAI_API_KEY` isn't set, **429** if the daily generation
     cap is hit. Generated candidates appear in a picker grid — toggle which ones you want, then
     "Add selected to gallery" attaches them as real `ProductImage` rows.
   - Each attached image can be tagged with a colour (so it shows for that variant), given alt
     text (saved on blur), reordered with ↑/↓, or removed.
7. **Details** — Fabric, Care instructions, Gender (`MEN`/`WOMEN`/`UNISEX`/`BOYS`/`GIRLS`/`KIDS`),
   Size chart (optional — leave as "None" to inherit the category's default), Tags
   (comma-separated), and Featured / New arrival checkboxes.
8. **SEO** — SEO title and description, with a live Google-style snippet preview
   (`daakyka.com › products › {slug}`) underneath.
9. **Save draft** — enabled once Name and Price are filled in. `POST /api/admin/products` (create)
   or `PATCH /api/admin/products/[id]` (edit), followed by `POST /api/admin/products/[id]/variants`
   if there are variant rows to persist. A new product's status is always `DRAFT` until published.
10. **Publish** — requires `products:publish` (a separate permission from `products:manage` — see
    [ROLES.md](./ROLES.md)); the button is disabled with a "Requires products:publish" tooltip
    otherwise. Publishing calls `POST /api/admin/products/[id]/publish` with `{ action: "publish" }`
    and flips status to `ACTIVE`. The same endpoint handles **Unpublish** (back to `DRAFT`) and
    **Archive** (`{ action: "archive" }`, status `ARCHIVED`) — archiving only needs
    `products:manage`, since taking a live product down is treated as ordinary catalog upkeep
    rather than a launch decision.

### Field reference and validation (`productInputSchema`, `src/lib/catalog/products.ts`)

| Field | Constraint |
|---|---|
| `name` | required, 1–200 chars |
| `slug` | optional (auto-derived); lowercase letters/numbers/hyphens only |
| `shortDescription` | optional, ≤300 chars |
| `description` | optional, ≤5000 chars |
| `categoryId` | required |
| `status` | `DRAFT` \| `ACTIVE` \| `ARCHIVED` |
| `price` | required, > 0 |
| `compareAtPrice` | optional, > 0, and must be > `price` (enforced both client-side and server-side via `InvalidCompareAtPriceError`) |
| `gender` | `MEN` \| `WOMEN` \| `UNISEX` \| `BOYS` \| `GIRLS` \| `KIDS` |
| `fabric` | optional, ≤200 chars |
| `care` | optional, ≤500 chars |
| `tags` | optional, up to 30 tags, each ≤50 chars |
| `sizeChartId` | optional |
| `seoTitle` | optional, ≤200 chars |
| `seoDescription` | optional, ≤300 chars |

Variant rows (`variantsInputSchema`): `size` (1–40 chars), `color` (1–60 chars), `colorHex`
(optional, must match `#RRGGBB`), `sku` (1–80 chars), `price` (optional override, > 0),
`stock` (integer, 0–1,000,000), `active` (boolean). Up to 200 variants per request.
`assertUniqueVariants()` rejects duplicate (size, colour) pairs or duplicate SKUs — this runs both
in the variant editor UI and again server-side in `replaceVariants()`, so the rules can't drift.

### Duplicate, archive, delete

- **Duplicate** (`POST /api/admin/products/[id]/duplicate`) — copies the product's fields,
  variants (with freshly generated SKUs against the new slug), and images into a new `DRAFT`
  product named `"{name} (copy)"` with a `-copy` slug suffix. Always available once the product
  has been saved.
- **Archive** — sets status to `ARCHIVED`; needs `products:manage` only.
- **Delete** — permanent, and only allowed when the product is **`DRAFT`** *and* has **zero order
  items** against it (`ProductNotDraftError` / `ProductDeleteBlockedError` otherwise, surfaced as a
  409). The Delete button is disabled with a tooltip ("Only draft products with no orders can be
  deleted") when either condition fails, and a confirm dialog guards the click either way.

## CSV import / export

`/admin/products/import` (requires `products:manage`). One **row per variant**, grouped by
`product_slug` — a product with 3 sizes × 2 colours is 6 rows sharing the same slug.

### Columns (`IMPORT_COLUMNS`, `src/lib/catalog/csv.ts`)

```
product_slug, product_name, category_slug, short_description, description, price,
compare_at_price, fabric, care, gender, tags, seo_title, seo_description,
size, color, color_hex, sku, stock, variant_active, generate_images
```

Required per row: `product_slug`, `product_name`, `category_slug`, `price`, `size`, `color`,
`sku`. Download the exact template from **Download CSV template**
(`GET /api/admin/products/import/template`), and export the current catalog for reference or
bulk-editing via **Export all products (CSV)** (`GET /api/admin/products/export`).

Notes on parsing:
- `tags` is pipe-separated (`scrub|unisex|hospital`), not comma-separated (commas are the CSV
  delimiter).
- `gender` is validated against the same enum as the product form; an unrecognized value is a
  **warning**, not an error, and defaults to `UNISEX`.
- `variant_active` and `generate_images` accept `yes` / `true` / `1` as true (case-insensitive
  match), anything else (including blank) as false — except `variant_active` defaults to **true**
  when left blank.
- `compare_at_price`, if set, must be greater than `price` — same rule as the admin form.
- SKUs are checked for duplicates **within the file itself** (error) and against SKUs that already
  exist in the DB (warning — that row will update the existing variant, not create a new one).

### Dry run → commit

1. Pick a CSV file (max 2MB) and click **Run dry run**. This posts to
   `POST /api/admin/products/import` with `mode=dryRun`, which validates every row
   (`validateImportRows()`) against real category slugs and existing SKUs from the DB, and returns
   a per-row result: `rowNumber`, `status` (`ok` / `warning` / `error`), and any messages, plus a
   summary count (`total`, `ok`, `warning`, `error`, `products`). Nothing is written yet.
2. Fix any rows marked `error` in the source file and re-run the dry run — **Commit import** stays
   disabled until `summary.error === 0` and at least one row parsed.
3. Optionally check **"Generate AI images for imported products without any"** — this sets
   `generateImages=yes` on the commit request, which queues AI generation (subject to the same
   daily cap and `OPENAI_API_KEY` requirement as the product form — see
   [IMAGES_AI.md](./IMAGES_AI.md)) for any product in the file with `generate_images=yes` and no
   existing images.
4. Click **Commit import** — `mode=commit` re-validates from scratch server-side (it never trusts
   a stale client-side dry run) and writes everything in a single transaction
   (`commitProductImport()`). A row that fails validation at commit time (e.g. someone else's edit
   raced you) returns **409** with the same per-row detail rather than a partial write. On success
   you get a summary: products created, products updated, variants written, and images queued.

The import route is rate-limited to 10 requests/minute and rejects non-multipart or
oversized (>2MB) uploads before even parsing the file.

## See also

- [ROLES.md](./ROLES.md) — which roles can view/manage/publish products.
- [IMAGES_AI.md](./IMAGES_AI.md) — AI image generation details and the daily cap.
- [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) — the rest of the admin panel.
