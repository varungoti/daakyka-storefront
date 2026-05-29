"use client";

import type { OutfitTryOnRequest, OutfitTryOnResponse, TryOnGender } from "@/lib/outfit/types";
import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (!enabled || !request?.topImageUrl) {
      setResult(null);
      setLoading(false);
      return;
    }

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
          body: JSON.stringify(request),
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
    enabled,
    debounceMs,
    request?.gender,
    request?.topImageUrl,
    request?.bottomImageUrl,
    request?.topHandle,
    request?.bottomHandle,
    request?.color,
  ]);

  return { result, loading, error, previewUrl: result?.resultImageUrl ?? null };
}

export type { TryOnGender };
