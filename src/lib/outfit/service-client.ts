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

  try {
    const response = await fetch(`${baseUrl}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gender: payload.gender,
        top_garment_url: payload.topImageUrl,
        bottom_garment_url: payload.bottomImageUrl,
        avatar_url: payload.avatarImageUrl,
        top_handle: payload.topHandle,
        bottom_handle: payload.bottomHandle,
        color: payload.color,
      }),
      signal: AbortSignal.timeout(120_000),
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
