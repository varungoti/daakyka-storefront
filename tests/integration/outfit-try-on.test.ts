import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST as postTryOn } from "@/app/api/outfit/try-on/route";
import { withEnv } from "../helpers/env";

function tryOnRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/outfit/try-on", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/outfit/try-on", () => {
  it("rejects an untrusted image host (SSRF guard)", async () => {
    const response = await postTryOn(
      tryOnRequest({
        gender: "female",
        topImageUrl: "https://evil.example.com/malicious.jpg",
      }),
    );
    assert.equal(response.status, 400);
  });

  it("rejects a non-https image URL even for a trusted host", async () => {
    const response = await postTryOn(
      tryOnRequest({
        gender: "female",
        topImageUrl: "http://images.unsplash.com/photo.jpg",
      }),
    );
    assert.equal(response.status, 400);
  });

  it("accepts a trusted image host and falls back gracefully without a configured AR service", async () => {
    await withEnv({ AR_TRYON_SERVICE_URL: undefined, OUTFIT_SERVICE_URL: undefined }, async () => {
      const response = await postTryOn(
        tryOnRequest({
          gender: "female",
          topImageUrl: "https://images.unsplash.com/photo-123.jpg",
        }),
      );
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean; mode: string };
      assert.equal(data.ok, true);
      assert.equal(data.mode, "fallback");
    });
  });
});
