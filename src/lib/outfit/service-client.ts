import type { OutfitTryOnRequest, OutfitTryOnResponse } from "@/lib/outfit/types";

export function getArTryOnServiceUrl(): string | undefined {
  return (
    process.env.AR_TRYON_SERVICE_URL?.replace(/\/$/, "") ??
    process.env.OUTFIT_SERVICE_URL?.replace(/\/$/, "")
  );
}

export async function callArTryOnService(
  payload: OutfitTryOnRequest,
): Promise<OutfitTryOnResponse | null> {
  const baseUrl = getArTryOnServiceUrl();
  if (!baseUrl) return null;

  const apiKey = process.env.AR_TRYON_API_KEY;

  try {
    const response = await fetch(`${baseUrl}/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        gender: payload.gender,
        top_garment_url: payload.topImageUrl,
        bottom_garment_url: payload.bottomImageUrl,
        avatar_url: payload.avatarImageUrl,
        top_handle: payload.topHandle,
        bottom_handle: payload.bottomHandle,
        color: payload.color,
      }),
      // Comfortably under the route's own maxDuration (vercel.json) so
      // this route's catch block can still return a graceful fallback
      // response instead of Vercel killing the function outright.
      signal: AbortSignal.timeout(100_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      ok?: boolean;
      mode?: string;
      result_image_url?: string;
      job_id?: string;
      cached?: boolean;
    };

    if (!data.result_image_url) return null;

    return {
      ok: true,
      mode: data.mode === "ar-tryon" ? "ar-tryon" : "fallback",
      resultImageUrl: data.result_image_url,
      jobId: data.job_id,
      cached: data.cached,
    };
  } catch {
    return null;
  }
}
