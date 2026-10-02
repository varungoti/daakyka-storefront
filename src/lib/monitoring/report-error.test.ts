import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { buildErrorReport, reportRequestError, resetErrorReporting } from "@/lib/monitoring/report-error";
import { withEnv } from "../../../tests/helpers/env";

/**
 * F-234: the onRequestError reporter. Pure behaviour only: a stub `fetch` and
 * an injected log sink stand in for the network and stderr, so nothing here
 * touches a real webhook.
 */

const request = { path: "/products/scrub-top?token=secret-abc&email=a@b.com#frag", method: "GET" };
const context = { routerKind: "App Router", routePath: "/products/[handle]", routeType: "render" };

type FetchCall = { url: string; init: RequestInit };

function stubFetch(status = 200) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { calls, impl };
}

describe("buildErrorReport", () => {
  it("keeps the path but drops the query string and fragment", () => {
    const report = buildErrorReport(new Error("boom"), request, context);
    assert.equal(report.path, "/products/scrub-top");
    assert.ok(!JSON.stringify(report).includes("secret-abc"));
    assert.ok(!JSON.stringify(report).includes("a@b.com"));
  });

  it("never carries request headers, even when the caller passes them", () => {
    const withHeaders = {
      ...request,
      headers: { cookie: "admin_session=very-secret", authorization: "Bearer very-secret" },
    };
    const report = buildErrorReport(new Error("boom"), withHeaders, context);
    assert.ok(!JSON.stringify(report).includes("very-secret"));
  });

  it("reads the digest Next attaches and truncates long messages", () => {
    const error = Object.assign(new Error("x".repeat(2000)), { digest: "1234567" });
    const report = buildErrorReport(error, request, context);
    assert.equal(report.digest, "1234567");
    assert.ok(report.message.length < 400);
    assert.equal(report.routePath, "/products/[handle]");
    assert.equal(report.routeType, "render");
    assert.equal(report.event, "request_error");
  });

  it("copes with a non-Error throw", () => {
    const report = buildErrorReport("plain string", request, context);
    assert.equal(report.message, "plain string");
    assert.equal(report.digest, null);
  });
});

describe("reportRequestError", () => {
  beforeEach(() => resetErrorReporting());
  afterEach(() => {
    mock.restoreAll();
    resetErrorReporting();
  });

  it("always writes one structured line, and does not call fetch when no webhook is set", async () => {
    const { calls, impl } = stubFetch();
    const lines: string[] = [];
    await withEnv({ ERROR_WEBHOOK_URL: undefined }, async () => {
      await reportRequestError(new Error("boom"), request, context, { fetchImpl: impl, log: (l) => lines.push(l) });
    });
    assert.equal(calls.length, 0);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event, "request_error");
    assert.equal(parsed.message, "boom");
    assert.equal(typeof parsed.stack, "string");
  });

  it("posts a header-free summary to an https webhook", async () => {
    const { calls, impl } = stubFetch();
    await withEnv({ ERROR_WEBHOOK_URL: "https://hooks.example.com/services/T0/B0/xyz" }, async () => {
      await reportRequestError(new Error("db down"), request, context, { fetchImpl: impl, log: () => {} });
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://hooks.example.com/services/T0/B0/xyz");
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(String(calls[0].init.body));
    assert.match(body.text, /GET \/products\/\[handle\]: Error: db down/);
    assert.equal(body.path, "/products/scrub-top");
    assert.equal(body.stack, undefined, "the stack stays in the logs, not the webhook");
    assert.ok(!JSON.stringify(body).includes("secret-abc"));
  });

  it("ignores a webhook that is not https", async () => {
    const { calls, impl } = stubFetch();
    const warn = mock.method(console, "warn", () => {});
    await withEnv({ ERROR_WEBHOOK_URL: "http://hooks.example.com/x" }, async () => {
      await reportRequestError(new Error("boom"), request, context, { fetchImpl: impl, log: () => {} });
    });
    assert.equal(calls.length, 0);
    assert.equal(warn.mock.callCount(), 1);
  });

  it("sends the same error to the webhook once per window, but logs every occurrence", async () => {
    const { calls, impl } = stubFetch();
    const lines: string[] = [];
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    await withEnv({ ERROR_WEBHOOK_URL: "https://hooks.example.com/x" }, async () => {
      const options = { fetchImpl: impl, log: (l: string) => lines.push(l) };
      await reportRequestError(error, request, context, { ...options, now: 1_000_000 });
      await reportRequestError(error, request, context, { ...options, now: 1_000_000 + 60_000 });
      assert.equal(calls.length, 1, "a repeat inside 5 minutes is not re-sent");
      await reportRequestError(error, request, context, { ...options, now: 1_000_000 + 6 * 60_000 });
      assert.equal(calls.length, 2, "after the window it is sent again");
    });
    assert.equal(lines.length, 3);
  });

  it("does not report Next's notFound/redirect control-flow digests", async () => {
    const { calls, impl } = stubFetch();
    const lines: string[] = [];
    const control = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    await withEnv({ ERROR_WEBHOOK_URL: "https://hooks.example.com/x" }, async () => {
      await reportRequestError(control, request, context, { fetchImpl: impl, log: (l) => lines.push(l) });
    });
    assert.equal(calls.length, 0);
    assert.equal(lines.length, 0);
  });

  it("never throws when the webhook is down, slow or answers an error", async () => {
    mock.method(console, "warn", () => {});
    const failing = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await withEnv({ ERROR_WEBHOOK_URL: "https://hooks.example.com/x" }, async () => {
      await assert.doesNotReject(
        reportRequestError(new Error("a"), request, context, { fetchImpl: failing, log: () => {} }),
      );
      const { impl } = stubFetch(500);
      await assert.doesNotReject(
        reportRequestError(new Error("b"), request, context, { fetchImpl: impl, log: () => {} }),
      );
    });
  });
});
