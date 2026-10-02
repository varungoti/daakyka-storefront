"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { SHOP_URL_PENDING_SCRIPT } from "@/lib/shop/url-pending";
import { useSyncExternalStore } from "react";

/**
 * The two pieces of markup behind the "don't paint the unfiltered grid on a
 * filtered deep link" fix — see src/lib/shop/url-pending.ts for the why. Both
 * are children of ShopPageContent's results container (`group/results`), which
 * is what the inline script marks with `data-shop-url-pending`.
 */

const subscribeToNothing = () => () => {};

/** First child of the results container. `display: none` by default (it is a
 * script), and it takes no grid cell. Server-rendered into the static HTML, so
 * it runs when the HTML is parsed — before any card below it is painted — and
 * is hydrated, not re-run, by React.
 *
 * It renders only on the server and while hydrating (`useSyncExternalStore`'s
 * server snapshot is `false`), never on a client-side navigation: there the
 * page is created by React in the browser, a script React creates is inert, and
 * development builds log an error for every one ("Encountered a script tag while
 * rendering React component"). A client-side navigation does not need it — the
 * filters are applied in a layout effect before its first paint. After hydration
 * the snapshot turns `true` and React drops the (already executed) element. */
export function ShopUrlPendingScript() {
  const clientRender = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  if (clientRender) return null;
  return <script dangerouslySetInnerHTML={{ __html: SHOP_URL_PENDING_SCRIPT }} />;
}

/** What stands in for the hidden grid while the mark is set: the toolbar and
 * a few rows of card-shaped blocks, laid out on the same two-column grid and
 * padding as the container so nothing moves when the real results appear.
 * `display: none` (and no cost beyond a few inert nodes) unless the container
 * is marked; `visible` because the marked container is `visibility: hidden`
 * and a child may override that. */
export function ShopUrlPendingMask() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden grid-cols-1 gap-10 px-4 group-data-[shop-url-pending]/results:visible group-data-[shop-url-pending]/results:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8"
    >
      <div className="hidden space-y-3 lg:block">
        <Skeleton className="h-8 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-xl" />
        ))}
      </div>
      <div>
        <Skeleton className="mb-4 h-24 w-full rounded-2xl sm:mb-6" />
        <div className="grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] w-full rounded-3xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
