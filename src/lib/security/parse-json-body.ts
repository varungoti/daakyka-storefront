import { NextResponse } from "next/server";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type JsonBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function readJsonBody<T = unknown>(request: Request): Promise<JsonBodyResult<T>> {
  // A same-origin fetch() call always sets this explicitly; an HTML
  // <form> submission (the vector for a cross-site request that rides
  // on the browser's cookies) can only send
  // application/x-www-form-urlencoded, multipart/form-data, or
  // text/plain — never application/json. Rejecting anything else here
  // is a simple, broad CSRF mitigation across every route that calls
  // this helper.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      ),
    };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Payload too large" }, { status: 413 }),
    };
  }

  const text = await request.text();
  if (text.length > MAX_JSON_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Payload too large" }, { status: 413 }),
    };
  }

  if (!text.trim()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Empty body" }, { status: 400 }),
    };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }
}
