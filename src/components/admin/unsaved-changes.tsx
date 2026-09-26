"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Release-hardening F-13 (docs/audit-2026-09-19/admin-ux.md): editing a
 * field on an admin form and then navigating away silently discarded the
 * edit, with no warning of any kind. Next.js 16's App Router has no
 * built-in router-navigation guard (there is no `beforeRouteChange` or
 * equivalent); the documented, supported pattern — see "Blocking
 * navigation" in
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md
 * (the `onNavigate` prop, introduced v15.3.0 and current in this repo's
 * Next 16.3.5) — is a shared React Context that tracks whether *some* form
 * on the page is dirty, read by a `<Link onNavigate>` wrapper that can
 * `preventDefault()` the navigation. That covers in-app `<Link>`
 * navigation (the sidebar, "View Storefront", etc). It does not cover the
 * browser's own back/forward/reload/close, which is a separate, native
 * `beforeunload` handler with no Next-specific API at all — both are
 * wired up here so a dirty form is protected either way.
 *
 * The Provider lives in src/app/admin/(panel)/layout.tsx, wrapping both
 * the sidebar (src/components/admin/admin-shell.tsx, whose nav links use
 * <GuardedLink>) and the page content, so a form nested deep in `children`
 * can block a `<Link>` click in the sidebar two levels up.
 *
 * F-184: `beforeunload` does NOT cover the browser/phone Back button (or
 * Forward) while staying inside the app. In the App Router, Back/Forward is
 * a `popstate` *soft* navigation — the tab never actually unloads, so
 * `beforeunload` never fires — and nothing else in this file listened for
 * `popstate` at all, so a dirty form's Back button silently discarded the
 * edit. `installBackGuard` below fixes that with the standard
 * push-a-sentinel-history-entry technique (see its own doc comment).
 */

export const CONFIRM_MESSAGE = "You have unsaved changes. Leave without saving?";

interface UnsavedChangesContextValue {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  /** Returns true when it's safe to proceed (nothing dirty, or the admin
   * confirmed leaving anyway). Used both by <GuardedLink> and by any
   * programmatic navigation (e.g. a "Back to list" button, Sign Out) that
   * a form's own code triggers. */
  confirmLeave: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [dirty, setDirty] = useState(false);

  const confirmLeave = useCallback(() => {
    if (!dirty) return true;
    // Deliberate: the standard browser-native confirmation for a
    // destructive, hard-to-undo action, matching the pattern the Next.js
    // docs themselves use for this exact scenario (see the file-level
    // comment above).
    return window.confirm(CONFIRM_MESSAGE);
  }, [dirty]);

  const value = useMemo(() => ({ dirty, setDirty, confirmLeave }), [dirty, confirmLeave]);

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

function useUnsavedChangesContext(): UnsavedChangesContextValue {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error("useUnsavedChangesContext must be used within an UnsavedChangesProvider");
  }
  return ctx;
}

/**
 * Called by a form with its own computed `dirty` boolean (see
 * src/lib/admin/is-dirty.ts for the comparison helper forms use to compute
 * it). Registers the `beforeunload` guard for the browser
 * close/reload/typed-URL case, and publishes `dirty` to the shared context
 * so a <GuardedLink> anywhere on the page (e.g. the sidebar) knows to
 * confirm before navigating. Clears the shared flag on unmount so it never
 * outlives the form that set it.
 */
export function useUnsavedChangesGuard(dirty: boolean): void {
  const { setDirty } = useUnsavedChangesContext();

  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);

  useEffect(() => {
    return () => setDirty(false);
  }, [setDirty]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required for the confirmation to show in some browsers; the
      // string itself is never displayed by modern browsers, which show
      // their own fixed message instead.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // F-184: see installBackGuard's doc comment for how this actually works.
  useEffect(() => {
    if (!dirty) return;
    if (typeof window === "undefined") return;
    return installBackGuard(window);
  }, [dirty]);
}

/** The minimal `window` surface `installBackGuard` needs — narrowed so a
 * unit test can pass a plain mock object instead of needing a real DOM
 * (this repo's unit tests run under Node's test runner with no jsdom — see
 * product-view-tracker.test.ts for the same pattern). */
export interface BackGuardWindow {
  history: {
    state: unknown;
    pushState: (data: unknown, unused: string, url?: string | null) => void;
    back: () => void;
  };
  location: { href: string };
  confirm: (message: string) => boolean;
  addEventListener: (type: "popstate", listener: () => void) => void;
  removeEventListener: (type: "popstate", listener: () => void) => void;
}

/**
 * F-184: catches the browser/phone Back (and Forward) button on a dirty
 * form, which `beforeunload` cannot see (App Router Back/Forward is a
 * `popstate` soft navigation — the page never unloads).
 *
 * How it works: pushes one extra history entry ("the sentinel") at the
 * *same* URL right on top of the current one. Because the sentinel and the
 * real entry beneath it share a URL, a single Back press pops the sentinel
 * without changing the visible page at all — Next.js's own popstate
 * handler (app-router.js) just re-affirms the same route tree. That gives
 * us a synchronous `popstate` event to react to *before* anything the user
 * can see has changed:
 *   - Cancelled: push a fresh sentinel, so the very next Back press is
 *     caught the same way.
 *   - Confirmed: call `history.back()` again ourselves, which now pops the
 *     *real* entry underneath and genuinely navigates away — a single Back
 *     press (from the user's perspective) still only takes one confirm.
 *
 * `window.history.pushState`/`replaceState` are patched by Next's
 * `AppRouter` (see node_modules/next/dist/client/components/app-router.js,
 * `copyNextJsInternalHistoryState`) to always copy its own `__NA` /
 * `__PRIVATE_NEXTJS_INTERNALS_TREE` keys from the *current* entry onto
 * whatever we push, so the sentinel is automatically a history entry Next's
 * router recognizes as its own (no full reload) — we don't need to set
 * those keys ourselves, only avoid clobbering them, hence spreading
 * `history.state` first.
 *
 * Returns a cleanup that removes the popstate listener. It does not try to
 * pop the sentinel itself: React's own effect cleanup already runs
 * whenever `dirty` goes back to false (e.g. after Save), and leaving one
 * harmless same-URL sentinel entry behind costs the user nothing worse
 * than one extra no-op Back press if they never actually leave this page.
 */
export function installBackGuard(win: BackGuardWindow): () => void {
  let leaving = false;

  const pushSentinel = () => {
    win.history.pushState({ ...(win.history.state as object | null), __unsavedGuard: true }, "", win.location.href);
  };

  pushSentinel();

  function onPopState() {
    if (leaving) return; // this pop is the real, confirmed departure — let it through untouched.
    if (win.confirm(CONFIRM_MESSAGE)) {
      leaving = true;
      win.history.back();
    } else {
      pushSentinel();
    }
  }

  win.addEventListener("popstate", onPopState);
  return () => win.removeEventListener("popstate", onPopState);
}

/** For code that triggers navigation imperatively (a "Back to list"
 * button, Sign Out) rather than through a <Link> — call `confirmLeave()`
 * before proceeding. */
export function useUnsavedChangesNav(): { confirmLeave: () => boolean } {
  const { confirmLeave } = useUnsavedChangesContext();
  return { confirmLeave };
}

/**
 * Drop-in replacement for `next/link`'s `<Link>` that confirms before
 * leaving a dirty form, via the `onNavigate` prop — see the file-level
 * comment for why this is the mechanism (not e.g. a router hook: Next 16's
 * App Router has no programmatic router-navigation guard). Only intercepts
 * in-app client-side navigation; an external URL, a new-tab click, or a
 * `download` link are all unaffected, matching `onNavigate`'s own documented
 * scope.
 */
export function GuardedLink({
  onNavigate,
  ...props
}: React.ComponentProps<typeof Link>) {
  const { confirmLeave } = useUnsavedChangesNav();

  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (!confirmLeave()) {
          event.preventDefault();
          return;
        }
        onNavigate?.(event);
      }}
    />
  );
}
