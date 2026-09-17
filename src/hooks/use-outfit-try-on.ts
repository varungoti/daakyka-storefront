"use client";

import type { OutfitTryOnRequest, OutfitTryOnResponse, TryOnGender } from "@/lib/outfit/types";
import { useEffect, useMemo, useRef, useState } from "react";

interface UseOutfitTryOnOptions {
  enabled?: boolean;
  debounceMs?: number;
}

export function useOutfitTryOn(
  request: OutfitTryOnRequest | null,
  options: UseOutfitTryOnOptions = {},
) {
  const { enabled = true, debounceMs = 450 } = options;
  const [result, setResult] = useState<OutfitTryOnResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasActiveRequest = enabled && Boolean(request?.topImageUrl);

  useEffect(() => {
    // Nothing to fetch: bail out without touching state here. The
    // hook derives idle result/loading/error from `hasActiveRequest`
    // below instead, so switching this off never needs an extra
    // setState-triggered render.
    if (!hasActiveRequest) return;

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/outfit/try-on", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender: request?.gender,
            topImageUrl: request?.topImageUrl,
            bottomImageUrl: request?.bottomImageUrl,
            avatarImageUrl: request?.avatarImageUrl,
            topHandle: request?.topHandle,
            bottomHandle: request?.bottomHandle,
            color: request?.color,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Try-on request failed");
        }

        const data = (await response.json()) as OutfitTryOnResponse;
        setResult(data);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Try-on failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [
    hasActiveRequest,
    debounceMs,
    request?.gender,
    request?.topImageUrl,
    request?.bottomImageUrl,
    request?.avatarImageUrl,
    request?.topHandle,
    request?.bottomHandle,
    request?.color,
  ]);

  const idleResult = useMemo(
    () => (hasActiveRequest ? result : null),
    [hasActiveRequest, result],
  );

  return {
    result: idleResult,
    loading: hasActiveRequest && loading,
    error: hasActiveRequest ? error : null,
    previewUrl: idleResult?.resultImageUrl ?? null,
  };
}

export type { TryOnGender };
