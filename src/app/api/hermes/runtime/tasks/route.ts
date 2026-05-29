import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeHermesRuntime } from "@/lib/hermes/runtime/auth";
import { routeHermesTask } from "@/lib/hermes/runtime/router";
import { getHermesMode } from "@/lib/hermes/client";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  type: z.string().min(2),
  mode: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  if (!authorizeHermesRuntime(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimitOrResponse(request, "hermes-runtime", 30, 60_000);
  if (limited) return limited;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task payload" }, { status: 400 });
  }

  try {
    const output = await routeHermesTask({
      type: parsed.data.type,
      mode: parsed.data.mode ?? getHermesMode(),
      input: parsed.data.input ?? {},
    });

    return NextResponse.json({
      taskId: randomUUID(),
      output: JSON.stringify(output),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes task failed" },
      { status: 500 },
    );
  }
}
