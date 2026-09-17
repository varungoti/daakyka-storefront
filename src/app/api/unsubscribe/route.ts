import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/engagement/unsubscribe";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";

/**
 * Handles both:
 *  - Our own /unsubscribe page's "Unsubscribe" button, which POSTs
 *    `{ token }` as JSON.
 *  - RFC 8058 one-click unsubscribe: a mail client POSTs directly to the
 *    `List-Unsubscribe` header URL (`/api/unsubscribe?token=...`, see
 *    sendMarketingEmail) with a `List-Unsubscribe-Post` body that has no
 *    token in it — the token lives in the URL for that path, so it's read
 *    from the query string first and the JSON body is only consulted when
 *    the query string doesn't have one.
 */
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "unsubscribe", 20, 60_000);
  if (limited) return limited;

  const url = new URL(request.url);
  let token = url.searchParams.get("token");

  if (!token) {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().startsWith("application/json")) {
      const bodyResult = await readJsonBody<{ token?: unknown }>(request);
      if (!bodyResult.ok) return bodyResult.response;
      token = typeof bodyResult.data.token === "string" ? bodyResult.data.token : null;
    }
  }

  if (!token) {
    return NextResponse.json({ error: "Missing unsubscribe token" }, { status: 400 });
  }

  const result = await unsubscribeByToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, alreadyUnsubscribed: result.alreadyUnsubscribed });
}

// A manually-clicked GET link still works as a convenience; the RFC 8058
// one-click flow itself always uses POST.
export async function GET(request: Request) {
  return POST(request);
}
