export interface HermesTaskInput {
  type: string;
  mode: string;
  input: Record<string, unknown>;
}

interface ModelProfile {
  model: string;
  maxTokens: number;
  temperature: number;
}

const profiles: Record<string, ModelProfile> = {
  seo_scan: { model: "accounts/fireworks/models/llama-v3p1-8b-instruct", maxTokens: 1200, temperature: 0.2 },
  daily_seo_health_scan: {
    model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    maxTokens: 1500,
    temperature: 0.2,
  },
  weekly_competitor_scan: {
    model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    maxTokens: 1500,
    temperature: 0.3,
  },
  weekly_growth_report: {
    model: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    maxTokens: 2500,
    temperature: 0.35,
  },
  blog_draft: { model: "accounts/fireworks/models/llama-v3p1-70b-instruct", maxTokens: 3000, temperature: 0.5 },
  campaign_draft: {
    model: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    maxTokens: 2000,
    temperature: 0.45,
  },
  default: { model: "accounts/fireworks/models/llama-v3p1-70b-instruct", maxTokens: 1800, temperature: 0.35 },
};

function promptForTask(task: HermesTaskInput): string {
  const base = `You are Hermes, the DAAKYKA medical apparel marketing agent. Mode: ${task.mode}. Task type: ${task.type}.`;
  const inputJson = JSON.stringify(task.input).slice(0, 8000);
  return `${base}\nReturn strict JSON with keys: summary, recommendations (array), actions (array), risks (array).\nInput:\n${inputJson}`;
}

async function callFireworks(profile: ModelProfile, prompt: string): Promise<string> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    return JSON.stringify({
      summary: "Fireworks API key not configured for Hermes runtime.",
      recommendations: ["Set FIREWORKS_API_KEY in Vercel project environment variables."],
      actions: [],
      risks: [],
      stub: true,
    });
  }

  const response = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: profile.maxTokens,
      temperature: profile.temperature,
      messages: [
        { role: "system", content: "You are a precise JSON-only marketing operations assistant." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  return data.choices?.[0]?.message?.content ?? JSON.stringify({ summary: "Empty model response" });
}

export async function routeHermesTask(task: HermesTaskInput): Promise<Record<string, unknown>> {
  const profile = profiles[task.type] ?? profiles.default;
  const content = await callFireworks(profile, promptForTask(task));

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {
      summary: content.slice(0, 500),
      recommendations: [],
      actions: [],
      risks: [],
      raw: content,
    };
  }
}

export function getHermesRuntimeInfo() {
  return {
    service: "daakyka-hermes",
    platform: "vercel",
    fireworks: Boolean(process.env.FIREWORKS_API_KEY),
    inline: process.env.HERMES_RUNTIME_INLINE === "1",
    mode: process.env.HERMES_DEFAULT_MODE ?? "SUGGEST_ONLY",
  };
}
