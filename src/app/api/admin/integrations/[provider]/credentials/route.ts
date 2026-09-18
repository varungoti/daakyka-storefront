import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  clearCredential,
  getCredentialMeta,
  isCredentialKey,
  setCredential,
  type CredentialProvider,
} from "@/lib/integrations/credential-store";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

const providers: CredentialProvider[] = ["RAZORPAY", "BREVO"];

const setSchema = z.object({
  key: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(500),
});

const clearSchema = z.object({
  key: z.string().trim().min(1).max(100),
});

interface RouteParams {
  params: Promise<{ provider: string }>;
}

function normalizeProvider(provider: string): CredentialProvider | null {
  const normalized = provider.toUpperCase();
  return (providers as string[]).includes(normalized) ? (normalized as CredentialProvider) : null;
}

export async function POST(request: Request, { params }: RouteParams) {
  const limited = await rateLimitOrResponse(request, "admin-integration-credentials", 20, 60_000);
  if (limited) return limited;

  const { session, error } = await requireAdminPermission("integrations:manage");
  if (error) return error;

  const { provider: rawProvider } = await params;
  const provider = normalizeProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = setSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { key, value } = parsed.data;
  if (!isCredentialKey(provider, key)) {
    return NextResponse.json({ error: "Unknown credential key" }, { status: 400 });
  }

  await setCredential(provider, key, value, session!.id);
  const meta = await getCredentialMeta(provider, key);

  // Never echo the value back — the response only proves it was set.
  return NextResponse.json({ provider, key, ...meta });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const limited = await rateLimitOrResponse(request, "admin-integration-credentials", 20, 60_000);
  if (limited) return limited;

  const { session, error } = await requireAdminPermission("integrations:manage");
  if (error) return error;

  const { provider: rawProvider } = await params;
  const provider = normalizeProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = clearSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { key } = parsed.data;
  if (!isCredentialKey(provider, key)) {
    return NextResponse.json({ error: "Unknown credential key" }, { status: 400 });
  }

  // clearCredential already audit-logs the "clear" action (never the value).
  await clearCredential(provider, key, session!.id);

  return NextResponse.json({ provider, key, configured: false, updatedAt: null, updatedByName: null });
}
