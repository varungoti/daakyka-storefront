import { formatApiError } from "@/lib/validation/format-api-error";

export async function adminRequest(url: string, fallback: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
  } catch {
    throw new Error(`${fallback} Check your connection and try again.`);
  }
  if (response.ok) return response;
  if (response.status === 401) throw new Error("Your session expired. Sign in again and retry.");
  if (response.status === 403) throw new Error("Your role does not have permission for this action.");
  const body: unknown = await response.json().catch(() => null);
  throw new Error(formatApiError(body, fallback).summary);
}
