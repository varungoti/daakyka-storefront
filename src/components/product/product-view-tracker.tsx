"use client";

import { useEffect } from "react";

export function ProductViewTracker({
  handle,
  name,
}: {
  handle: string;
  name: string;
}) {
  useEffect(() => {
    const sessionId =
      sessionStorage.getItem("daakyka-session") ??
      (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem("daakyka-session", id);
        return id;
      })();

    fetch("/api/analytics/product-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productHandle: handle, productName: name, sessionId }),
      keepalive: true,
    }).catch(() => undefined);
  }, [handle, name]);

  return null;
}
