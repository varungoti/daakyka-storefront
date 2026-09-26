import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeFailuresByMessage, uploadErrorMessage, uploadFilesSequentially } from "@/lib/admin/retryable-upload";

function file(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// A tiny (fractional-second) Retry-After keeps these tests fast while
// still exercising the real wait-then-retry path (rather than 0, which
// the helper treats as "missing" and falls back to a 1-second wait).
function rateLimitedResponse(retryAfterSeconds = 0.02): Response {
  const headers = new Headers();
  headers.set("Retry-After", String(retryAfterSeconds));
  return new Response(JSON.stringify({ error: "Too many requests." }), { status: 429, headers });
}

function failedResponse(status = 400): Response {
  return new Response(JSON.stringify({ error: "bad file" }), { status });
}

describe("uploadFilesSequentially (F-324)", () => {
  it("uploads every file and reports ok outcomes with retriedAfterRateLimit false", async () => {
    const files = [file("a.png"), file("b.png")];
    const outcomes = await uploadFilesSequentially(files, async () => okResponse());

    assert.equal(outcomes.length, 2);
    for (const outcome of outcomes) {
      assert.equal(outcome.response.ok, true);
      assert.equal(outcome.retriedAfterRateLimit, false);
    }
  });

  it("retries a 429 exactly once, waiting out its Retry-After first", async () => {
    const calls: string[] = [];
    const outcomes = await uploadFilesSequentially([file("rate-limited.png")], async (f) => {
      calls.push(f.name);
      return calls.length === 1 ? rateLimitedResponse() : okResponse();
    });

    assert.equal(calls.length, 2, "expected exactly one retry after the 429");
    assert.equal(outcomes[0].response.ok, true);
    assert.equal(outcomes[0].retriedAfterRateLimit, true);
  });

  it("gives up after one retry if still rate-limited, without retrying a second time", async () => {
    const calls: string[] = [];
    const outcomes = await uploadFilesSequentially([file("still-limited.png")], async (f) => {
      calls.push(f.name);
      return rateLimitedResponse();
    });

    assert.equal(calls.length, 2, "expected exactly one automatic retry, not an unbounded loop");
    assert.equal(outcomes[0].response.status, 429);
    assert.equal(outcomes[0].retriedAfterRateLimit, true);
  });

  it("does not retry a non-429 failure", async () => {
    const calls: string[] = [];
    const outcomes = await uploadFilesSequentially([file("bad.png")], async (f) => {
      calls.push(f.name);
      return failedResponse(400);
    });

    assert.equal(calls.length, 1);
    assert.equal(outcomes[0].response.status, 400);
    assert.equal(outcomes[0].retriedAfterRateLimit, false);
  });

  it("processes files in order and keeps going after a failure", async () => {
    const files = [file("first.png"), file("second-fails.png"), file("third.png")];
    const outcomes = await uploadFilesSequentially(files, async (f) =>
      f.name === "second-fails.png" ? failedResponse(500) : okResponse(),
    );

    assert.equal(outcomes.length, 3);
    assert.equal(outcomes[0].response.ok, true);
    assert.equal(outcomes[1].response.ok, false);
    assert.equal(outcomes[2].response.ok, true);
  });
});

describe("uploadErrorMessage (F-365)", () => {
  it("returns the server's own JSON error message", async () => {
    const response = new Response(JSON.stringify({ error: "Unsupported file type — use JPEG, PNG, WebP, or AVIF" }), {
      status: 400,
    });
    assert.equal(await uploadErrorMessage(response), "Unsupported file type — use JPEG, PNG, WebP, or AVIF");
  });

  it("falls back to a size-specific message for a non-JSON 413 (Vercel's own platform response)", async () => {
    const response = new Response("Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE", { status: 413 });
    assert.equal(await uploadErrorMessage(response), "Image is too large to upload");
  });

  it("falls back to a generic message for a non-JSON, non-413 failure", async () => {
    const response = new Response("Internal Server Error", { status: 500 });
    assert.equal(await uploadErrorMessage(response), "Upload failed");
  });

  it("falls back to a generic message when the JSON body has no error field", async () => {
    const response = new Response(JSON.stringify({ ok: false }), { status: 500 });
    assert.equal(await uploadErrorMessage(response), "Upload failed");
  });
});

describe("summarizeFailuresByMessage (F-324)", () => {
  it("returns null for no failures", () => {
    assert.equal(summarizeFailuresByMessage([]), null);
  });

  it("groups file names under their shared message, preserving first-seen message order", () => {
    const summary = summarizeFailuresByMessage([
      { file: file("a.png"), message: "Upload failed." },
      { file: file("b.png"), message: "Storage not configured." },
      { file: file("c.png"), message: "Upload failed." },
    ]);

    assert.equal(summary, "Upload failed. (a.png, c.png) Storage not configured. (b.png)");
  });
});
