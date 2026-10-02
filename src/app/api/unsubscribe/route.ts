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
 * Only POST changes anything — see GET below.
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

/**
 * F-055: GET used to call POST, so any GET unsubscribed — including a
 * corporate mail scanner prefetching the `List-Unsubscribe` URL (RFC 8058
 * reserves the one-click action for POST precisely because scanners fetch
 * URLs with GET) — and a person who opened that header URL in a browser got
 * raw JSON. It now only hands the browser to the confirmation page, whose
 * button does the POST; the one-click flow itself is unchanged. 303 (not
 * 307/308) so the follow-up request is always a plain GET.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const destination = new URL("/unsubscribe", request.url);
  if (token) destination.searchParams.set("token", token);
  return NextResponse.redirect(destination, 303);
}
