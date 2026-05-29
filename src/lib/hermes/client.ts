import { randomUUID } from "node:crypto";
import { isIntegrationEnabled } from "@/lib/integrations/enabled";
import { routeHermesTask } from "@/lib/hermes/runtime/router";

export type HermesMode =
  | "SUGGEST_ONLY"
  | "DRAFT_MODE"
  | "ASSISTED_PUBLISH"
  | "AUTONOMOUS_SAFE";

export interface HermesTaskRequest {
  type: string;
  input?: Record<string, unknown>;
  mode?: HermesMode;
}

export interface HermesTaskResponse {
  ok: boolean;
  taskId?: string;
  output?: string;
  error?: string;
  stub?: boolean;
  local?: boolean;
  runtime?: "inline" | "http";
}

export function getHermesMode(): HermesMode {
  const mode = process.env.HERMES_DEFAULT_MODE as HermesMode | undefined;
  return mode ?? "SUGGEST_ONLY";
}

export function isHermesInlineRuntime(): boolean {
  return process.env.HERMES_RUNTIME_INLINE === "1";
}

function getHermesBaseUrl(): string | undefined {
  return (
    process.env.HERMES_LOCAL_URL?.replace(/\/$/, "") ??
    process.env.HERMES_API_URL?.replace(/\/$/, "")
  );
}

export function isHermesRuntimeConfigured(): boolean {
  return Boolean(getHermesBaseUrl()) || isHermesInlineRuntime();
}

async function dispatchInlineHermesTask(request: HermesTaskRequest): Promise<HermesTaskResponse> {
  try {
    const output = await routeHermesTask({
      type: request.type,
      mode: request.mode ?? getHermesMode(),
      input: request.input ?? {},
    });

    return {
      ok: true,
      taskId: randomUUID(),
      output: JSON.stringify(output),
      local: true,
      runtime: "inline",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hermes inline dispatch failed",
      runtime: "inline",
    };
  }
}

export async function dispatchHermesTask(
  request: HermesTaskRequest,
): Promise<HermesTaskResponse> {
  const baseUrl = getHermesBaseUrl();
  const useInline = isHermesInlineRuntime();
  const useLocalUrl = Boolean(process.env.HERMES_LOCAL_URL);

  if (!baseUrl && !useInline) {
    if (!(await isIntegrationEnabled("HERMES"))) {
      return {
        ok: true,
        stub: true,
        output: JSON.stringify({
          message: "Hermes runtime not configured — task recorded locally for approval queue.",
          type: request.type,
          suggestions: [
            "Review product SEO metadata for top 5 SKUs",
            "Draft weekly growth report from campaign metrics",
            "Identify blog keyword gap: hospital uniform care guide",
          ],
        }),
      };
    }
    return {
      ok: false,
      error: "HERMES_RUNTIME_INLINE, HERMES_LOCAL_URL, or HERMES_API_URL is required when Hermes is enabled",
    };
  }

  if (useInline) {
    if (!(await isIntegrationEnabled("HERMES"))) {
      return {
        ok: true,
        stub: true,
        output: JSON.stringify({
          message: "Hermes disabled in admin integrations — enable to dispatch tasks.",
          type: request.type,
        }),
      };
    }
    return dispatchInlineHermesTask(request);
  }

  if (!useLocalUrl && !(await isIntegrationEnabled("HERMES"))) {
    return {
      ok: true,
      stub: true,
      output: JSON.stringify({
        message: "Hermes disabled in admin integrations — enable to dispatch tasks.",
        type: request.type,
      }),
    };
  }

  const apiKey = process.env.HERMES_API_KEY;

  try {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        type: request.type,
        mode: request.mode ?? getHermesMode(),
        input: request.input ?? {},
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: body || response.statusText, runtime: "http" };
    }

    const data = (await response.json()) as { taskId?: string; output?: string };
    return {
      ok: true,
      taskId: data.taskId,
      output: data.output,
      local: useLocalUrl,
      runtime: "http",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hermes dispatch failed",
      runtime: "http",
    };
  }
}
