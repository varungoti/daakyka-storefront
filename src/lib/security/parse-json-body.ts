import { NextResponse } from "next/server";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type JsonBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function readJsonBody<T = unknown>(request: Request): Promise<JsonBodyResult<T>> {
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
