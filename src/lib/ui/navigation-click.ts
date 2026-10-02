/**
 * F-091: decides whether a click on a link starts a navigation to a different
 * page of this site — i.e. whether the top progress bar should appear. Pure (no
 * DOM), so a test can drive it; NavigationProgress reads the values off the
 * real event and anchor.
 *
 * A root `loading.tsx` would have given the same "something is happening"
 * answer, but a Suspense boundary above every route makes Next start streaming
 * before a page can call `notFound()`, which turns the real 404s on unknown
 * product, category and blog URLs into 200 "soft 404s" (see the loading.tsx
 * test in src/lib/seo/page-metadata.test.ts). A progress bar outside the page
 * tree has no such effect.
 */
export interface NavigationClick {
  /** The anchor's resolved `href` (`anchor.href`). */
  href: string;
  /** The anchor's `target` attribute ("" when unset). */
  target: string;
  /** Whether the anchor has a `download` attribute. */
  download: boolean;
  /** The page the click happened on (`window.location.href`). */
  currentHref: string;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function isTrackableNavigationClick(click: NavigationClick): boolean {
  // Only a plain primary click: a modified click opens a new tab or window, and
  // the current page stays exactly as it is.
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (click.download || (click.target !== "" && click.target !== "_self")) return false;

  let destination: URL;
  let current: URL;
  try {
    destination = new URL(click.href);
    current = new URL(click.currentHref);
  } catch {
    return false;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") return false;
  if (destination.origin !== current.origin) return false;

  // Same page: a jump to an anchor on it ("#reviews"), or the link to where the
  // shopper already is. Nothing is going to load.
  return destination.pathname !== current.pathname || destination.search !== current.search;
}
