import OpenAI from "openai";
import type { ImagesResponse } from "openai/resources/images";
import type { MediaAsset, MediaUsage } from "@/generated/prisma/client";
import { MediaSource } from "@/generated/prisma/client";
import {
  buildPrompt,
  sizeForAspect,
  type AspectRatio,
  type PromptFields,
  type PromptPreset,
} from "@/lib/ai/prompt-presets";
import { isUploadOnlySlot } from "@/data/media/image-manifest";
import { db } from "@/lib/db";
import {
  defaultStorageDeps,
  saveMediaAsset,
  type StorageDeps,
} from "@/lib/media/store";

/**
 * The newest GPT image model id found in the installed `openai` SDK's own
 * type definitions (node_modules/openai/src/resources/images.ts,
 * `ImageModel` union) at the time this was written: the "2.5" generation
 * (gpt-image-2.5-sunburst / gpt-image-2.5-flare) supersedes gpt-image-2,
 * gpt-image-1.5 and gpt-image-1. Both 2.5 variants ship the same day in
 * that union with no documented functional difference for our use (both
 * support b64_json output, the size/quality range we need, and subtle
 * transparent backgrounds); "sunburst" is the one consistently listed
 * first everywhere it appears. Override via OPENAI_IMAGE_MODEL (e.g. to
 * switch to "gpt-image-2.5-flare") without a code change.
 */
const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const DEFAULT_DAILY_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 90_000;

export function getImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

export function isImageGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getDailyLimit(): number {
  const raw = Number(process.env.AI_IMAGE_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_LIMIT;
}

export class ImageGenerationNotConfiguredError extends Error {
  constructor(message = "AI image generation is not configured — set OPENAI_API_KEY") {
    super(message);
    this.name = "ImageGenerationNotConfiguredError";
  }
}

export class DailyLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(`Daily AI image generation limit of ${limit} has been reached`);
    this.name = "DailyLimitReachedError";
  }
}

export class GenerationFailedError extends Error {
  constructor(message = "AI image generation failed") {
    super(message);
    this.name = "GenerationFailedError";
  }
}

export class SlotNotAiGeneratableError extends Error {
  constructor(slot: string) {
    super(
      `The "${slot}" slot depicts a real person or a real company's trademark and can only be set by uploading the real image — it is never AI-generated.`,
    );
    this.name = "SlotNotAiGeneratableError";
  }
}

/** UTC-midnight boundary for "today", so the cap resets at a fixed, unambiguous instant regardless of server timezone. */
function utcMidnightToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function countAiImagesGeneratedToday(): Promise<number> {
  return db.mediaAsset.count({
    where: {
      source: MediaSource.AI,
      createdAt: { gte: utcMidnightToday() },
    },
  });
}

/**
 * The minimal shape `generateImage` needs from an OpenAI client — small
 * enough that tests can pass an in-memory fake that never touches the
 * network. The real `OpenAI` instance satisfies this structurally.
 */
export interface OpenAIImageClient {
  images: {
    generate(params: {
      model: string;
      prompt: string;
      size: ImagesResponse["size"];
      quality?: "low" | "medium" | "high";
      n?: number;
    }): Promise<Pick<ImagesResponse, "data">>;
  };
}

let cachedClient: OpenAIImageClient | null = null;

function getDefaultClient(): OpenAIImageClient {
  if (!cachedClient) {
    // Cast: the real OpenAI client's `images.generate` genuinely satisfies
    // this narrower interface at runtime (it accepts every field we pass
    // and returns a superset of what we read back), but its full generated
    // type is a large overloaded union that isn't worth threading through
    // here.
    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    }) as unknown as OpenAIImageClient;
  }
  return cachedClient;
}

export interface GenerateImageInput {
  preset: PromptPreset;
  fields?: PromptFields;
  /** Skips prompt building entirely and sends this text verbatim when set. */
  promptOverride?: string;
  aspect: AspectRatio;
  quality?: "low" | "medium" | "high";
  usage: MediaUsage;
  slot?: string;
  alt?: string;
  createdById?: string;
}

export interface GenerateImageDeps {
  client?: OpenAIImageClient;
  storage?: StorageDeps;
}

/**
 * Generates an image with OpenAI, processes and stores it exactly like an
 * uploaded image (via `saveMediaAsset`), and records its prompt/model on
 * the resulting `MediaAsset`. Enforces the `ai:generate` daily cap before
 * ever calling OpenAI, so a request that would exceed it never spends
 * quota. Also refuses (`SlotNotAiGeneratableError`) any `input.slot` marked
 * `uploadOnly` in the image manifest (real founder portraits, real client
 * logos) — enforced here, server-side, rather than only hiding the
 * "Generate with AI" button in the admin UI, since the UI check alone
 * wouldn't stop a direct API call. Callers are responsible for the
 * `ai:generate` permission check and audit logging (see the API route).
 */
export async function generateImage(
  input: GenerateImageInput,
  deps: GenerateImageDeps = {},
): Promise<MediaAsset> {
  if (!isImageGenerationConfigured()) {
    throw new ImageGenerationNotConfiguredError();
  }

  if (isUploadOnlySlot(input.slot)) {
    throw new SlotNotAiGeneratableError(input.slot as string);
  }

  const limit = getDailyLimit();
  const usedToday = await countAiImagesGeneratedToday();
  if (usedToday >= limit) {
    throw new DailyLimitReachedError(limit);
  }

  const prompt = input.promptOverride?.trim() || buildPrompt(input.preset, input.fields ?? {});
  const model = getImageModel();
  const client = deps.client ?? getDefaultClient();

  let b64: string | undefined;
  try {
    const response = await client.images.generate({
      model,
      prompt,
      size: sizeForAspect(input.aspect),
      quality: input.quality ?? "medium",
      n: 1,
    });
    b64 = response.data?.[0]?.b64_json;
  } catch (error) {
    throw new GenerationFailedError(
      error instanceof Error ? `AI image generation failed: ${error.message}` : "AI image generation failed",
    );
  }

  if (!b64) {
    throw new GenerationFailedError("AI image generation returned no image data");
  }

  const buffer = Buffer.from(b64, "base64");

  return saveMediaAsset(
    {
      buffer,
      usage: input.usage,
      source: MediaSource.AI,
      alt: input.alt,
      prompt,
      model,
      slot: input.slot,
      createdById: input.createdById,
    },
    deps.storage ?? defaultStorageDeps,
  );
}
