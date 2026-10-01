/**
 * The `revalidateTag()` profile for every cache an ADMIN save invalidates
 * (catalog, homepage, offers, testimonials, blog, site settings, media
 * slots) — F-032 / F-214.
 *
 * Those writes used to pass `"max"`, which per
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * revalidateTag.md is stale-while-revalidate: the first request after the
 * save is still served the OLD cached value while a refresh runs in the
 * background. The owner who clicks Save and immediately reloads the
 * storefront therefore saw the old price, the old hero, or a product they
 * had just unpublished, and it looked as if the save had failed.
 *
 * `{ expire: 0 }` is the documented alternative when stale content must
 * never be served and `updateTag` can't be used (it is Server-Actions-only;
 * these writes happen in Route Handlers): the next request is a blocking
 * revalidate instead. Keep `"max"` for background/system revalidation (cron,
 * bulk jobs, stock decrements) that doesn't need to be immediate.
 *
 * The single-argument `revalidateTag(tag)` form behaves the same today but
 * is deprecated, so always pass this explicitly.
 */
export const ADMIN_REVALIDATE_PROFILE = { expire: 0 } as const;

/** What `revalidateTag`'s second argument accepts — widened from the old
 * `string` so injectable `revalidate` test seams can take the object form. */
export type RevalidateProfile = string | { expire?: number };
