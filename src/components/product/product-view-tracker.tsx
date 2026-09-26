"use client";

import { useEffect } from "react";

// F-104: a browser that blocks site storage (Chrome "Don't allow sites to
// save data", iOS Safari "Block All Cookies") throws a SecurityError on the
// mere property access `sessionStorage`/`crypto.randomUUID`, not just on
// getItem/setItem — so the try has to wrap the whole lookup, not sit inside
// it. Falls back to an in-memory id for the life of this page view so
// analytics still roughly groups requests when storage is unavailable.
let memorySessionId: string | undefined;

// Exported (only) so product-view-tracker.test.ts can drive it directly with
// a mocked `window.sessionStorage` — this repo's unit tests run under Node's
// test runner with no DOM/jsdom, so mounting the component to fire its
// effect isn't an option here the way it would be with React Testing
// Library. This is the exact call that used to crash the PDP's error
// boundary, so exercising it directly still covers the regression.
export function getSessionId(): string | undefined {
  try {
    const existing = window.sessionStorage.getItem("daakyka-session");
    if (existing) return existing;
  } catch {
    // Storage blocked — fall through to the in-memory id below.
  }

  const id =
    memorySessionId ??
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : undefined);
  memorySessionId = id;

  if (id) {
    try {
      window.sessionStorage.setItem("daakyka-session", id);
    } catch {
      // Nothing to do — the in-memory id above still lets this view's
      // fetch carry a sessionId.
    }
  }

  return id;
}

export function ProductViewTracker({
  handle,
  name,
}: {
  handle: string;
  name: string;
}) {
  useEffect(() => {
    const sessionId = getSessionId();

    fetch("/api/analytics/product-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productHandle: handle, productName: name, sessionId }),
      keepalive: true,
    }).catch(() => undefined);
  }, [handle, name]);

  return null;
}
