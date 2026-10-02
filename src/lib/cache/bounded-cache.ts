import { unstable_cache } from "next/cache";

/**
 * A tag-invalidated `unstable_cache` read that can never go stale for more
 * than a few minutes, even when the data is changed WITHOUT a
 * `revalidateTag()` call.
 *
 * Why this exists (release-hardening audit F-273 / F-070, review follow-up):
 * `unstable_cache(fn, keys, { tags })` with no `revalidate` caches
 * "indefinitely or until matching revalidateTag() or revalidatePath()
 * methods are called"
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * unstable_cache.md), and the same doc says the entry persists "across
 * requests and deployments". An admin save calls revalidateTag, so that
 * path is fine. Anything that changes the database any other way is not:
 * prisma/seed.ts and prisma/seed-corrections.ts run inside the Vercel build,
 * where there is no request or static-generation store to call
 * revalidateTag from. A size chart, category or offer corrected by those
 * one-time steps would otherwise keep serving the pre-correction value from
 * the cache until someone happened to save the same record in /admin.
 *
 * Two things bound that here:
 *
 * 1. `revalidate`: the entry is stale after this many seconds. Next's
 *    incremental cache computes `ctx.revalidate || entry.value.revalidate`
 *    (node_modules/next/dist/server/lib/incremental-cache/index.js), so the
 *    new bound also applies to an entry written by an older deployment that
 *    had none. This is the same bound CATALOG_CACHE_REVALIDATE_SECONDS puts
 *    on the product and category reads in src/lib/products/index.ts.
 * 2. {@link BOUNDED_CACHE_KEY_VERSION} is part of the cache key. An entry
 *    written before the bound existed has a different key, so it is never
 *    read at all: the first request after the deploy reads the corrected
 *    rows instead of being served the old value once while a background
 *    refresh runs. (Same trick as the "bounded-v2" key on the category tree
 *    in src/lib/products/index.ts.) Bump it if a future one-time correction
 *    needs the same guarantee.
 *
 * An admin save still invalidates immediately through its tag; this is only
 * the safety net underneath.
 */
export const BOUNDED_CACHE_REVALIDATE_SECONDS = 300;

export const BOUNDED_CACHE_KEY_VERSION = "bounded-v2";

/**
 * `unstable_cache` with the bounded TTL and versioned key applied in one
 * place, so a call site cannot forget either.
 *
 * `cache` is a test seam: `next/cache`'s exports are non-configurable and
 * the tests run as real ESM, so nothing in it can be spied on. A test
 * injects a recorder instead and asserts the exact key and options passed.
 */
export function boundedCache<T extends Parameters<typeof unstable_cache>[0]>(
  fetcher: T,
  keyParts: string[],
  tags: string[],
  cache: typeof unstable_cache = unstable_cache,
): T {
  return cache(fetcher, [BOUNDED_CACHE_KEY_VERSION, ...keyParts], {
    tags,
    revalidate: BOUNDED_CACHE_REVALIDATE_SECONDS,
  });
}
