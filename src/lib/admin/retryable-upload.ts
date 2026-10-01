/**
 * F-324: shared "upload N files, one at a time, and don't silently drop
 * one that hits a 429" helper for the admin gallery upload flows (product
 * gallery, staged product gallery). A batch used to loop over every
 * selected file and, on any non-OK response, just show a fixed "One or
 * more uploads failed." and move on — including for a 429 from
 * admin-media-upload's 30/minute limiter, which isn't a bad file at all
 * and is gone again within a minute. Selecting more than 30 photos (or
 * two staff uploading from the same office IP) silently dropped every
 * file past the 30th with no indication of which ones, and no retry.
 *
 * This retries a 429'd file exactly once, honouring its Retry-After
 * header (capped at MAX_RETRY_WAIT_MS so one large Retry-After can't
 * stall an entire batch), before giving up on it — and reports every
 * file's outcome by name so a caller can tell the admin exactly which
 * ones didn't make it, instead of a single undifferentiated failure
 * count.
 */

export interface FileUploadOutcome {
  file: File;
  response: Response;
  /** True once this result already went through the automatic 429 retry
   * below — lets a caller distinguish "still failing after we waited"
   * from an ordinary one-shot failure (a bad file, a 5xx). */
  retriedAfterRateLimit: boolean;
}

/** A large Retry-After shouldn't stall the whole batch indefinitely —
 * wait at most this long before retrying, even if the header asked for
 * more. */
const MAX_RETRY_WAIT_MS = 15_000;

const NETWORK_ERROR_MESSAGE = "Couldn't reach the server — check your connection and try again";
/** Not a real HTTP status: marks a request that never got a response at
 * all. 599 is unassigned, so it can't collide with anything a server here
 * actually sends, and is still a valid `Response` status to construct. */
const NETWORK_ERROR_STATUS = 599;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response): number {
  const raw = Number(response.headers.get("Retry-After"));
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return Math.min(MAX_RETRY_WAIT_MS, seconds * 1000);
}

/**
 * Uploads `files` sequentially via `send(file)`. A 429 response is waited
 * out (per Retry-After) and retried exactly once before moving on to the
 * next file; every other outcome (ok, or a non-429 failure) is recorded
 * immediately. Returns one outcome per input file, in the same order.
 */
export async function uploadFilesSequentially(
  files: readonly File[],
  send: (file: File) => Promise<Response>,
): Promise<FileUploadOutcome[]> {
  const outcomes: FileUploadOutcome[] = [];

  // A thrown `send` (the browser's fetch rejects on a dropped connection)
  // used to abort the whole loop: files already uploaded earlier in the
  // batch never got attached (orphaned in storage), the rest never ran,
  // and the caller saw an unhandled rejection instead of any message.
  // Turned into a per-file failed outcome instead, so every other file
  // still gets its turn and the admin is told which one(s) failed.
  const safeSend = async (file: File): Promise<Response> => {
    try {
      return await send(file);
    } catch {
      return new Response(JSON.stringify({ error: NETWORK_ERROR_MESSAGE }), {
        status: NETWORK_ERROR_STATUS,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  for (const file of files) {
    let response = await safeSend(file);
    let retriedAfterRateLimit = false;

    if (response.status === 429) {
      await sleep(retryDelayMs(response));
      response = await safeSend(file);
      retriedAfterRateLimit = true;
    }

    outcomes.push({ file, response, retriedAfterRateLimit });
  }

  return outcomes;
}

/**
 * F-365 fix: reads a failed upload response's actual reason instead of a
 * caller hardcoding a fixed "Upload failed" for every non-OK status — the
 * server already returns a clear `{ error }` body (e.g. "Unsupported file
 * type — use JPEG, PNG, WebP, or AVIF"), so this mirrors the pattern the
 * customer review form already uses (product-detail.tsx's
 * handlePhotoUpload) instead of dropping it. Vercel's own 413 response for
 * a request body over its platform limit (F-178) isn't JSON, so a body
 * that fails to parse falls back to a size-specific message for a 413 and
 * a generic one otherwise.
 */
export async function uploadErrorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const error = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : undefined;
  if (typeof error === "string" && error) return error;
  if (response.status === 413) return "Image is too large to upload";
  return "Upload failed";
}

/**
 * Groups failed outcomes by a caller-chosen message, so several files
 * that failed for the same reason ("Image storage isn't configured yet",
 * "Still rate limited after waiting") are reported together as one line
 * with a file list, rather than one line per file.
 */
export function summarizeFailuresByMessage(
  failures: readonly { file: File; message: string }[],
): string | null {
  if (failures.length === 0) return null;

  const order: string[] = [];
  const byMessage = new Map<string, string[]>();
  for (const { file, message } of failures) {
    if (!byMessage.has(message)) {
      byMessage.set(message, []);
      order.push(message);
    }
    byMessage.get(message)!.push(file.name);
  }

  return order.map((message) => `${message} (${byMessage.get(message)!.join(", ")})`).join(" ");
}
