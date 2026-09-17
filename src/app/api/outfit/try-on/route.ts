import { NextResponse } from "next/server";
import { tryOnAvatars } from "@/data/media/catalog";
import { callArTryOnService } from "@/lib/outfit/service-client";
import type { OutfitTryOnRequest, OutfitTryOnResponse } from "@/lib/outfit/types";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { isTrustedImageUrl } from "@/lib/security/image-hosts";
import { z } from "zod";

// Beyond just being a well-formed URL, topImageUrl/bottomImageUrl must
// point at a host this app actually serves product images from — the
// AR try-on service fetches whatever URL it's given server-side, so an
// unrestricted URL here is a server-side request forgery vector (e.g.
// pointing it at a cloud metadata endpoint).
const trustedImageUrl = z.string().url().refine(isTrustedImageUrl, {
  message: "Image URL host is not allowed",
});

const schema = z.object({
  gender: z.enum(["male", "female"]),
  topImageUrl: trustedImageUrl,
  bottomImageUrl: trustedImageUrl.optional(),
  topHandle: z.string().optional(),
  bottomHandle: z.string().optional(),
  color: z.string().optional(),
});

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "outfit-try-on", 20, 60_000);
  if (limited) return limited;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid try-on payload" }, { status: 400 });
  }

  const payload: OutfitTryOnRequest = {
    ...parsed.data,
    avatarImageUrl: tryOnAvatars[parsed.data.gender],
  };

  const serviceResult = await callArTryOnService(payload);
  if (serviceResult) {
    return NextResponse.json(serviceResult satisfies OutfitTryOnResponse);
  }

  const avatarFallback = tryOnAvatars[payload.gender];
  const response: OutfitTryOnResponse = {
    ok: true,
    mode: "fallback",
    resultImageUrl: payload.topImageUrl || avatarFallback,
  };

  return NextResponse.json(response);
}
