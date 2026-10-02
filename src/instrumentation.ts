import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
  }
}

/**
 * F-234: Next calls this for every server error (render, route handler,
 * server action, proxy). It records a structured log line and, when
 * ERROR_WEBHOOK_URL is set, pings a webhook. See
 * src/lib/monitoring/report-error.ts for what is and is not forwarded
 * (never headers, cookies, query strings or bodies).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportRequestError } = await import("@/lib/monitoring/report-error");
  await reportRequestError(err, request, context);
};
