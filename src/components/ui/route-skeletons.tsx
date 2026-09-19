import { Skeleton } from "@/components/ui/skeleton";

/**
 * Content-shaped `loading.tsx` fallbacks (release-hardening F11/F14 CLS
 * fix — see docs/audit-2026-09-19/storefront-ux.md F11 and
 * docs/audit-2026-09-19/correctness.md F14). Each composition below
 * mirrors the *real* component tree it stands in for — same wrapper
 * classNames (padding, `max-w-[1320px]`, grid columns) as
 * `ShopPageContent`, `ProductDetail`, `SectionLandingPage`, `AccountTabs`
 * — so the reserved space is close to the incoming content's real height
 * instead of the old fixed `min-h-[50vh]` block that let the footer jump
 * ~17,600px on swap.
 */

function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    </div>
  );
}

function ProductCardsGridSkeleton({
  count = 8,
  className = "grid gap-6 sm:grid-cols-2 xl:grid-cols-4",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Mirrors `ProductGrid`'s toolbar (src/components/shop/product-grid.tsx):
 * search input + "N products" / sort-by row. `withSearch` matches whether
 * the caller wires `onSearchQueryChange` (only `/shop` and `/category`
 * do — `SectionLandingPage`'s grid has no search box). */
function ProductGridToolbarSkeleton({ withSearch = true }: { withSearch?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface-elevated px-5 py-4">
      {withSearch && <Skeleton className="h-11 w-full rounded-full" />}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-36 rounded-full" />
      </div>
    </div>
  );
}

/** Desktop-only `ShopFiltersPanel` column — hidden below `lg`, same as the
 * real panel, so it costs nothing on the mobile viewports Lighthouse
 * measures but still avoids a desktop shift. */
function ShopFiltersSkeleton() {
  return (
    <div className="hidden space-y-8 lg:block">
      <div className="space-y-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full" />
      </div>
      {Array.from({ length: 3 }).map((_, group) => (
        <div key={group} className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `/shop` and `/category/[slug]` — both render `ShopPageContent`, whose
 * `showExtras` prop mirrors this component's own (true only on `/shop`:
 * mix & match promo / trust bar / testimonials / feature cards below the
 * grid — `/category` opts out of all of that, same as the real page).
 */
export function ShopGridSkeleton({ showExtras = false }: { showExtras?: boolean }) {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-alt-surface py-10 md:py-14">
        <div className="relative mx-auto max-w-[1320px] px-4 lg:px-8">
          <Skeleton className="mb-6 h-4 w-32" />
          <div className="max-w-2xl space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-3/4 md:h-12" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </section>

      <section className="py-12 md:py-14">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 lg:grid-cols-[280px_1fr] lg:px-8">
          <ShopFiltersSkeleton />
          <div>
            <ProductGridToolbarSkeleton />
            <ProductCardsGridSkeleton />
          </div>
        </div>
      </section>

      {showExtras && (
        <section className="border-t border-border bg-alt-surface py-16">
          <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
            <Skeleton className="h-56 w-full rounded-3xl" />
          </div>
        </section>
      )}
    </>
  );
}

/** `/for-hospitals`, `/kids-wear`, `/school-uniforms` — all render
 * `SectionLandingPage`: centered hero + CTA pair, a sub-category tile
 * grid, then the same `ProductGrid` as `/shop` (without the search box). */
export function SectionLandingSkeleton() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-alt-surface py-12 md:py-16">
        <div className="relative mx-auto max-w-[1320px] px-4 text-center lg:px-8">
          <div className="mx-auto max-w-3xl space-y-3">
            <Skeleton className="mx-auto h-3 w-28" />
            <Skeleton className="mx-auto h-10 w-2/3" />
            <Skeleton className="mx-auto h-4 w-full" />
            <Skeleton className="mx-auto h-4 w-3/4" />
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Skeleton className="h-12 w-40 rounded-full" />
            <Skeleton className="h-12 w-44 rounded-full" />
          </div>
        </div>
      </section>

      <section className="bg-background py-12 md:py-16">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <Skeleton className="mb-8 h-7 w-40" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-border">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="p-4">
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-alt-surface py-12 md:py-16">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <Skeleton className="mb-8 h-7 w-48" />
          <ProductGridToolbarSkeleton withSearch={false} />
          <ProductCardsGridSkeleton />
        </div>
      </section>

      <section className="bg-brand-violet/20 py-12 md:py-16">
        <div className="mx-auto flex max-w-[1320px] flex-col items-center gap-6 px-4 lg:px-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-12 w-48 rounded-full" />
        </div>
      </section>
    </>
  );
}

/**
 * `/products/[handle]` — the tallest, most CLS-sensitive page (gallery +
 * info + accordions + reviews + related products). Mirrors
 * `src/app/products/[handle]/page.tsx` + `ProductDetail`.
 */
export function ProductDetailPageSkeleton() {
  return (
    <>
      <section className="border-b border-border bg-alt-surface py-6">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <Skeleton className="h-4 w-64" />
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="flex flex-col-reverse gap-4 lg:flex-row">
              <div className="flex gap-3 overflow-x-auto pb-1 lg:w-20 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-20 shrink-0 rounded-xl" />
                ))}
              </div>
              <Skeleton className="aspect-[4/5] flex-1 rounded-[2rem]" />
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <Skeleton className="h-9 w-3/4" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-8 w-32" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-3 w-14" />
                <div className="flex flex-wrap gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-10 rounded-full" />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Skeleton className="h-3 w-10" />
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-14 rounded-lg" />
                  ))}
                </div>
              </div>
              <Skeleton className="h-10 w-28 rounded-md" />
              <div className="flex flex-wrap gap-4 pt-2">
                <Skeleton className="h-12 w-40 rounded-full" />
                <Skeleton className="h-12 w-32 rounded-full" />
                <Skeleton className="h-12 w-12 rounded-md" />
              </div>
            </div>
          </div>

          <div className="mt-12 max-w-3xl">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border-b border-border py-4">
                <Skeleton className="h-5 w-40" />
              </div>
            ))}
          </div>

          <section className="mt-16 border-t border-border pt-12">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-10 w-36 rounded-md" />
            </div>
            <div className="mt-6 grid gap-10 md:grid-cols-[240px_1fr]">
              <div className="space-y-3">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-4 w-32" />
                <div className="space-y-1.5 pt-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-2 w-full" />
                  ))}
                </div>
              </div>
              <div className="space-y-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-2 border-b border-border pb-6">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>

      <section className="border-t border-border bg-alt-surface py-16">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <Skeleton className="mb-8 h-8 w-56" />
          <ProductCardsGridSkeleton count={4} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" />
        </div>
      </section>
    </>
  );
}

/** `/account` — `PageHeroBand` (centered welcome) + tab-pill row +
 * tab content, matching `AccountTabs`. */
export function AccountPageSkeleton() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-alt-surface py-12 md:py-16">
        <div className="relative mx-auto max-w-2xl px-4 text-center lg:px-8">
          <div className="space-y-3">
            <Skeleton className="mx-auto h-3 w-20" />
            <Skeleton className="mx-auto h-9 w-64" />
            <Skeleton className="mx-auto h-4 w-72" />
          </div>
        </div>
      </section>

      <section className="bg-background py-12 md:py-16">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <div className="flex flex-wrap gap-2 border-b border-border pb-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-24 rounded-full" />
            ))}
          </div>
          <div className="mt-8 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-2xl border border-border p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/** `/admin/(panel)/*` — the sidebar/topbar render in the layout above this
 * boundary, so only the content area needs a fallback. Admin pages vary
 * widely (dashboard stats, tables, forms), so this is a generic but much
 * taller placeholder than the old `min-h-[40vh]` spinner: a heading, a
 * stat-card row, and a list/table block. */
export function AdminPanelContentSkeleton() {
  return (
    <div className="space-y-8 py-4">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-border p-5">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
