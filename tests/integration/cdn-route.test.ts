import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET as getCdnObject } from "@/app/cdn/[...key]/route";

/**
 * release-hardening item 2 (F13, docs/audit-2026-09-19/correctness.md):
 * src/lib/storage/cdn-key.test.ts thoroughly covers resolveCdnObjectKey()
 * in isolation, but nothing previously exercised the actual route
 * handler (src/app/cdn/[...key]/route.ts) that calls it — i.e. nothing
 * proved the traversal guard is really wired into the HTTP path, only
 * that the pure function works. These tests call the real GET handler.
 *
 * A real R2 object fetch (the 200 path with Content-Type/Cache-Control
 * headers) isn't exercised here — R2 is unconfigured in this test
 * environment (see docs/audit-2026-09-19/admin-ux.md's environment
 * notes), and getObject() correctly throws when unconfigured, which the
 * route already catches into the same 404 as "not found". Both the
 * rejection path (this file) and that catch-into-404 behavior are
 * covered below; the happy-path headers are the one piece that would
 * need a configured bucket (or a mock) to exercise.
 */

function paramsFor(...segments: string[]) {
  return { params: Promise.resolve({ key: segments }) };
}

describe("GET /cdn/[...key]", () => {
  it("404s on an empty key", async () => {
    const response = await getCdnObject(new Request("http://localhost/cdn"), paramsFor());
    assert.equal(response.status, 404);
  });

  it("404s a single-encoded '..' traversal segment, never reaching R2", async () => {
    const response = await getCdnObject(
      new Request("http://localhost/cdn/.."),
      paramsFor(".."),
    );
    assert.equal(response.status, 404);
  });

  it("404s a double-encoded '..' traversal segment (F5 regression, at the route level)", async () => {
    // Arrives here as the literal string "%2e%2e" — see the doc comment
    // on resolveCdnObjectKey() for why the guard must decode fully
    // before validating, not the other way around.
    const response = await getCdnObject(
      new Request("http://localhost/cdn/%252e%252e"),
      paramsFor("%2e%2e"),
    );
    assert.equal(response.status, 404);
  });

  it("404s a segment smuggling a path separator after decoding", async () => {
    const response = await getCdnObject(
      new Request("http://localhost/cdn/foo%2fbar"),
      paramsFor("foo%2fbar"),
    );
    assert.equal(response.status, 404);
  });

  it("404s a well-formed but nonexistent key the same way (never a 5xx or a thrown error)", async () => {
    // No traversal here — this exercises the getObject() catch path
    // instead (R2 unconfigured in this environment, or a real "not
    // found" against a configured bucket both land here the same way).
    await assert.doesNotReject(async () => {
      const response = await getCdnObject(
        new Request("http://localhost/cdn/media/does-not-exist-rbac-matrix-fixture.webp"),
        paramsFor("media", "does-not-exist-rbac-matrix-fixture.webp"),
      );
      assert.equal(response.status, 404);
    });
  });
});
