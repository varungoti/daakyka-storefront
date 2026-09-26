import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { getCredential, type CredentialProvider } from "@/lib/integrations/credential-store";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";

/**
 * F-215 fix: /admin/integrations let an admin save a Razorpay or Brevo
 * credential with no way to know it actually works — a mistyped Key Secret
 * or a KEY_ID/KEY_SECRET pair from different modes (test vs live) still
 * showed "CONFIGURED", and the first sign of trouble was checkout returning
 * 502 to a real shopper. This calls the provider's own read-only account
 * endpoint with whatever key is currently in effect (DB first, then
 * env — the same resolution every other caller uses) and reports back
 * pass/fail without ever echoing the secret itself.
 */

const providers: CredentialProvider[] = ["RAZORPAY", "BREVO"];

interface RouteParams {
  params: Promise<{ provider: string }>;
}

interface TestResult {
  ok: boolean;
  message: string;
}

function normalizeProvider(provider: string): CredentialProvider | null {
  const normalized = provider.toUpperCase();
  return (providers as string[]).includes(normalized) ? (normalized as CredentialProvider) : null;
}

async function resolveCredential(
  provider: CredentialProvider,
  key: string,
  envVar: string,
): Promise<string | undefined> {
  return (await getCredential(provider, key)) ?? process.env[envVar] ?? undefined;
}

async function testRazorpay(): Promise<TestResult> {
  const [keyId, keySecret] = await Promise.all([
    resolveCredential("RAZORPAY", "KEY_ID", "RAZORPAY_KEY_ID"),
    resolveCredential("RAZORPAY", "KEY_SECRET", "RAZORPAY_KEY_SECRET"),
  ]);
  if (!keyId || !keySecret) {
    return { ok: false, message: "Key ID and Key Secret must both be set before testing." };
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  try {
    const response = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (response.ok) return { ok: true, message: "Razorpay accepted the Key ID / Key Secret pair." };
    if (response.status === 401) {
      return { ok: false, message: "Razorpay rejected the key pair (401 Unauthorized) — check for a mismatched test/live pair." };
    }
    return { ok: false, message: `Razorpay responded with HTTP ${response.status}.` };
  } catch {
    return { ok: false, message: "Couldn't reach Razorpay to verify the key — try again." };
  }
}

async function testBrevo(): Promise<TestResult> {
  const apiKey = await resolveCredential("BREVO", "API_KEY", "BREVO_API_KEY");
  if (!apiKey) {
    return { ok: false, message: "API Key must be set before testing." };
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": apiKey },
    });
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const email =
        body && typeof body === "object" && "email" in body && typeof body.email === "string"
          ? body.email
          : null;
      return { ok: true, message: email ? `Brevo accepted the key — account: ${email}` : "Brevo accepted the API key." };
    }
    if (response.status === 401) {
      return { ok: false, message: "Brevo rejected the API key (401 Unauthorized)." };
    }
    return { ok: false, message: `Brevo responded with HTTP ${response.status}.` };
  } catch {
    return { ok: false, message: "Couldn't reach Brevo to verify the key — try again." };
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const limited = await rateLimitOrResponse(request, "admin-integration-test", 10, 60_000);
  if (limited) return limited;

  const { error } = await requireAdminPermission("integrations:manage");
  if (error) return error;

  const { provider: rawProvider } = await params;
  const provider = normalizeProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const result = provider === "RAZORPAY" ? await testRazorpay() : await testBrevo();
  return NextResponse.json(result);
}
