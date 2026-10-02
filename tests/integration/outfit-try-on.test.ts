import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST as postTryOn } from "@/app/api/outfit/try-on/route";
import { getSetting, setSetting } from "@/lib/settings";
import { findAnyAdminId } from "../helpers/admin-user";
import { withEnv } from "../helpers/env";

function tryOnRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/outfit/try-on", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/outfit/try-on", () => {
  let adminId: string;
  let originalMixMatch: boolean;

  before(async () => {
    adminId = await findAnyAdminId();
    originalMixMatch = await getSetting("pages.mixMatch.enabled");
    // The feature is off by default; these cases exercise it switched on.
    await setSetting("pages.mixMatch.enabled", true, adminId);
  });

  after(async () => {
    await setSetting("pages.mixMatch.enabled", originalMixMatch, adminId);
  });

  // F-304: the studio page 404s while Mix & Match is off; the paid-service proxy behind it must too.
  it("answers 404, without validating or forwarding anything, while Mix & Match is switched off", async () => {
    await setSetting("pages.mixMatch.enabled", false, adminId);
    try {
      let forwarded = false;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        forwarded = true;
        return originalFetch(...args);
      }) as typeof fetch;
      try {
        await withEnv({ AR_TRYON_SERVICE_URL: "https://ar.example.com", AR_TRYON_API_KEY: "k" }, async () => {
          const response = await postTryOn(
            tryOnRequest({
              gender: "female",
              topImageUrl: "https://images.unsplash.com/photo-123.jpg",
            }),
          );
          assert.equal(response.status, 404);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(forwarded, false, "the AR service must not be called while the feature is off");
    } finally {
      await setSetting("pages.mixMatch.enabled", true, adminId);
    }
  });

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
