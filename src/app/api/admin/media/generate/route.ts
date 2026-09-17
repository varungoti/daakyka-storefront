import { NextResponse } from "next/server";
import { z } from "zod";
import { MediaUsage } from "@/generated/prisma/client";
import {
  DailyLimitReachedError,
  generateImage,
  GenerationFailedError,
  ImageGenerationNotConfiguredError,
} from "@/lib/ai/image-generation";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";

const PRESET_VALUES = [
  "product",
  "category-tile",
  "hero-banner",
  "hospital-scene",
  "school-scene",
  "kids-scene",
  "blog",
  "avatar",
  "how-to-measure",
] as const;

const MEDIA_USAGE_VALUES = Object.values(MediaUsage) as [MediaUsage, ...MediaUsage[]];

const generateSchema = z.object({
  preset: z.enum(PRESET_VALUES),
  fields: z
    .object({
      name: z.string().trim().max(200).optional(),
      color: z.string().trim().max(100).optional(),
      category: z.string().trim().max(120).optional(),
      gender: z.string().trim().max(50).optional(),
      fabric: z.string().trim().max(100).optional(),
      subject: z.string().trim().max(400).optional(),
      notes: z.string().trim().max(400).optional(),
    })
    .optional(),
  promptOverride: z.string().trim().min(1).max(4000).optional(),
  aspect: z.enum(["square", "portrait", "landscape"]),
  quality: z.enum(["low", "medium", "high"]).optional(),
  usage: z.enum(MEDIA_USAGE_VALUES),
  slot: z.string().trim().min(1).max(200).optional(),
  alt: z.string().trim().max(300).optional(),
});

/**
 * Generates an AI image with OpenAI (see src/lib/ai/image-generation.ts
 * for the daily cap, timeout, and typed-error handling) and stores it like
 * any other MediaAsset. Guarded by `ai:generate`, rate limited, and every
 * successful generation is audit logged with its prompt/model.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("ai:generate");
  if (error) return error;

  const limited = rateLimitOrResponse(request, "admin-media-generate", 20, 60_000);
  if (limited) return limited;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = generateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const asset = await generateImage({
      preset: parsed.data.preset,
      fields: parsed.data.fields,
      promptOverride: parsed.data.promptOverride,
      aspect: parsed.data.aspect,
      quality: parsed.data.quality,
      usage: parsed.data.usage,
      slot: parsed.data.slot,
      alt: parsed.data.alt,
      createdById: session.id,
    });

    await logAuditEvent({
      userId: session.id,
      action: "create",
      entity: "media_asset",
      entityId: asset.id,
      metadata: {
        source: "AI",
        preset: parsed.data.preset,
        model: asset.model,
        usage: parsed.data.usage,
      },
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    if (err instanceof ImageGenerationNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof DailyLimitReachedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof GenerationFailedError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
