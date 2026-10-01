/**
 * F-234: server-side error reporting, wired up from `onRequestError` in
 * src/instrumentation.ts.
 *
 * Until this existed nothing recorded or surfaced a production 500 beyond
 * Vercel's short-retention runtime log (the EMAXCONNSESSION 500s of
 * 2026-09-22 and 2026-09-25 were only visible there). This is deliberately
 * a thin, dependency-free scaffold rather than a vendor SDK:
 *
 *  1. Every error is written as ONE structured JSON line to stderr
 *     (`"event":"request_error"`). That is what a Vercel log drain, or an
 *     alert rule on the runtime logs, keys on, and it is also what the
 *     CERT-In log-retention policy in docs/INCIDENT_RESPONSE.md retains.
 *  2. When `ERROR_WEBHOOK_URL` is set to an https endpoint, a short, header
 *     free summary is also POSTed there (a Slack/Mattermost/Google Chat
 *     incoming webhook, or a small relay to Telegram/WhatsApp), de-duplicated
 *     per error so a crash loop cannot flood the channel.
 *
 * To move to Sentry later: `npm i @sentry/nextjs`, call `Sentry.init` in
 * `register()` and replace the body of `onRequestError` with
 * `Sentry.captureRequestError`. Nothing else in the app needs to change.
 *
 * Privacy: the request's headers (session cookie, Authorization), query
 * string and body are never read or forwarded, only the path, method and
 * Next's own route metadata. Error messages are truncated, because ORM and
 * driver errors can quote row values.
 *
 * Deliberately dependency-free and Edge-safe (fetch + console only).
 */

export interface RequestErrorInfo {
  /** Resource path as Next reports it. May carry a query string; that is stripped. */
  path: string;
  method: string;
}

export interface RequestErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string;
}

export interface ErrorReport {
  event: "request_error";
  timestamp: string;
  environment: string;
  release: string | null;
  name: string;
  message: string;
  digest: string | null;
  method: string;
  path: string;
  routePath: string | null;
  routeType: string | null;
  routerKind: string | null;
  renderSource: string | null;
  revalidateReason: string | null;
}

export interface ReportOptions {
  now?: number;
  fetchImpl?: typeof fetch;
  /** Receives the structured stderr line. Defaults to console.error. */
  log?: (line: string) => void;
}

const MAX_MESSAGE_LENGTH = 300;
const MAX_STACK_LENGTH = 1500;
const MAX_PATH_LENGTH = 200;
const WEBHOOK_TIMEOUT_MS = 3000;
const DEDUPE_WINDOW_MS = 5 * 60_000;
const MAX_TRACKED_ERRORS = 200;

const lastNotified = new Map<string, number>();
let warnedAboutWebhook = false;

/** Test helper: forgets which errors were already sent to the webhook. */
export function resetErrorReporting(): void {
  lastNotified.clear();
  warnedAboutWebhook = false;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function readDigest(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "digest" in err) {
    const digest = (err as { digest?: unknown }).digest;
    if (digest !== undefined && digest !== null) return String(digest);
  }
  return null;
}

/**
 * Next signals control flow (`notFound()`, `redirect()`) with specially
 * prefixed digests. Those are not failures and must not page anyone.
 */
function isControlFlowDigest(digest: string | null): boolean {
  return digest !== null && digest.startsWith("NEXT_");
}

/** Path only: query strings and fragments can carry tokens and PII. */
function pathOnly(path: string): string {
  return truncate(path.split(/[?#]/, 1)[0] ?? "", MAX_PATH_LENGTH);
}

/** Pure: shapes the report that is logged and (optionally) posted. */
export function buildErrorReport(
  err: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
  now: number = Date.now(),
): ErrorReport {
  const isError = err instanceof Error;
  return {
    event: "request_error",
    timestamp: new Date(now).toISOString(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    name: isError ? err.name : typeof err,
    message: truncate(isError ? err.message : String(err), MAX_MESSAGE_LENGTH),
    digest: readDigest(err),
    method: request.method,
    path: pathOnly(request.path),
    routePath: context.routePath ?? null,
    routeType: context.routeType ?? null,
    routerKind: context.routerKind ?? null,
    renderSource: context.renderSource ?? null,
    revalidateReason: context.revalidateReason ?? null,
  };
}

/** Returns the validated webhook URL, or null when unset or not https. */
function webhookUrl(): string | null {
  const raw = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    // fall through to the warning below
  }
  if (!warnedAboutWebhook) {
    warnedAboutWebhook = true;
    console.warn("[monitoring] ERROR_WEBHOOK_URL is set but is not a valid https:// URL; ignoring it.");
  }
  return null;
}

/** True when this error should be sent to the webhook now (not a recent repeat). */
function shouldNotify(report: ErrorReport, now: number): boolean {
  const key = report.digest ?? `${report.name}:${report.routePath ?? report.path}:${report.message}`;
  const previous = lastNotified.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return false;
  lastNotified.delete(key);
  lastNotified.set(key, now);
  if (lastNotified.size > MAX_TRACKED_ERRORS) {
    const oldest = lastNotified.keys().next().value;
    if (oldest !== undefined) lastNotified.delete(oldest);
  }
  return true;
}

function summary(report: ErrorReport): string {
  const where = report.routePath ?? report.path;
  const digest = report.digest ? ` (digest ${report.digest})` : "";
  return `[daakyka ${report.environment}] ${report.method} ${where}: ${report.name}: ${report.message}${digest}`;
}

/**
 * Logs the error and, when configured, notifies the webhook. Never throws:
 * a broken reporter must not turn a 500 into a worse failure, so every
 * failure here is swallowed after a console warning.
 */
export async function reportRequestError(
  err: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
  options: ReportOptions = {},
): Promise<void> {
  try {
    const now = options.now ?? Date.now();
    const report = buildErrorReport(err, request, context, now);
    if (isControlFlowDigest(report.digest)) return;

    const stack = err instanceof Error && err.stack ? truncate(err.stack, MAX_STACK_LENGTH) : undefined;
    const log = options.log ?? ((line: string) => console.error(line));
    log(JSON.stringify({ ...report, stack }));

    const url = webhookUrl();
    if (!url || !shouldNotify(report, now)) return;

    const send = options.fetchImpl ?? fetch;
    // Awaited, as Next's docs require for async work in onRequestError.
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary(report), ...report }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[monitoring] error webhook answered ${response.status}`);
    }
  } catch (reportingError) {
    console.warn(
      `[monitoring] could not report a request error: ${
        reportingError instanceof Error ? reportingError.message : String(reportingError)
      }`,
    );
  }
}
