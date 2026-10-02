"use client";

import { LazyMotion } from "framer-motion";
import { createContext, useCallback, useContext, useState } from "react";

// The animation engine is its own chunk, fetched on the visitor's first
// interaction rather than shipped in (or right after) the page's main JS:
// every storefront page mounts the cart, wishlist, search and filter drawers,
// which are the only things that animate, so the full `motion` component
// (~40 KB gzip, 90% unused at load, F-258) sat in the critical path of pages
// that never open one. Components use the `m.*` elements, which are inert
// until these features arrive; `strict` makes a stray full `motion.*`
// component throw in development instead of quietly pulling the whole engine
// back into the main bundle.
//
// The first press, touch, key press or focus anywhere on the page starts the
// download — all of them come before the click that opens a drawer, and the
// feature chunk is small — so a visitor who only reads or scrolls never
// downloads it.
const FIRST_INTERACTION_EVENTS = ["pointerdown", "touchstart", "keydown", "focusin"] as const;

function whenFirstInteraction(): Promise<void> {
  return new Promise((resolve) => {
    const listenerOptions = { capture: true, passive: true } as const;
    const onInteraction = () => {
      for (const type of FIRST_INTERACTION_EVENTS) {
        window.removeEventListener(type, onInteraction, listenerOptions);
      }
      resolve();
    };
    for (const type of FIRST_INTERACTION_EVENTS) {
      window.addEventListener(type, onInteraction, listenerOptions);
    }
  });
}

const MotionFeaturesReadyContext = createContext(false);

/**
 * The `initial` prop for an `m.*` overlay (drawer, dialog): the given
 * starting state once the animation features have loaded, `false` until then.
 *
 * Without the features an `m` element is inert, and an inert element with an
 * `initial` of `opacity: 0` / `x: "100%"` would stay off-screen for good —
 * a cart drawer that never shows, if the chunk is late or fails to load.
 * `false` renders it straight in its open state instead: a drawer opened
 * before the features arrive appears without sliding in, and every later one
 * animates as usual.
 */
export function useMotionInitial<T>(initial: T): T | false {
  return useContext(MotionFeaturesReadyContext) ? initial : false;
}

export function LazyMotionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const loadMotionFeatures = useCallback(
    () =>
      whenFirstInteraction()
        .then(() => import("@/lib/motion-features"))
        .then((mod) => {
          setReady(true);
          return mod.default;
        }),
    [],
  );

  return (
    <MotionFeaturesReadyContext.Provider value={ready}>
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
      </LazyMotion>
    </MotionFeaturesReadyContext.Provider>
  );
}
