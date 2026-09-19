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
 */

const CONFIRM_MESSAGE = "You have unsaved changes. Leave without saving?";

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
