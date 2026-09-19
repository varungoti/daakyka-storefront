import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeCron } from "@/lib/cron/authorize";
import { withEnv } from "../../../tests/helpers/env";

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/cron/journeys", {
    headers: header ? { authorization: header } : {},
  });
}

/** authorizeCron logs an actionable console.error on every denial when
 * CRON_SECRET is unset; silence it so these (expected) denials don't spam
 * test output. */
function silenceConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

describe("authorizeCron", () => {
  // F9 (docs/audit-2026-09-19/security.md): CRON_SECRET is now required
  // unconditionally — NODE_ENV === "development" is no longer a bypass,
  // since it reflects build mode, not who can reach the server.
  it("denies an unauthenticated request in development when CRON_SECRET is unset", async () => {
    await withEnv(
      { CRON_SECRET: undefined, CRON_ALLOW_UNAUTHENTICATED: undefined, NODE_ENV: "development" },
      () => {
        silenceConsoleError(() => {
          assert.equal(authorizeCron(requestWithAuth()), false);
        });
      },
    );
  });

  it("denies when CRON_SECRET is unset outside development", async () => {
    await withEnv(
      { CRON_SECRET: undefined, CRON_ALLOW_UNAUTHENTICATED: undefined, NODE_ENV: "production" },
      () => {
        silenceConsoleError(() => {
          assert.equal(authorizeCron(requestWithAuth()), false);
        });
      },
    );
  });

  it("allows when CRON_SECRET is unset but CRON_ALLOW_UNAUTHENTICATED=1 is explicitly set outside production", async () => {
    await withEnv(
      { CRON_SECRET: undefined, CRON_ALLOW_UNAUTHENTICATED: "1", NODE_ENV: "development" },
      () => {
        assert.equal(authorizeCron(requestWithAuth()), true);
      },
    );
  });

  it("still denies when CRON_ALLOW_UNAUTHENTICATED=1 if NODE_ENV is production (belt-and-suspenders on top of validateEnv())", async () => {
    await withEnv(
      { CRON_SECRET: undefined, CRON_ALLOW_UNAUTHENTICATED: "1", NODE_ENV: "production" },
      () => {
        silenceConsoleError(() => {
          assert.equal(authorizeCron(requestWithAuth()), false);
        });
      },
    );
  });

  it("denies a request with no bearer header when CRON_SECRET is set", async () => {
    await withEnv({ CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeCron(requestWithAuth()), false);
    });
  });

  it("denies an incorrect bearer token", async () => {
    await withEnv({ CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeCron(requestWithAuth("Bearer wrong-secret")), false);
    });
  });

  it("allows a request with the correct bearer token", async () => {
    await withEnv({ CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeCron(requestWithAuth("Bearer cron-secret")), true);
    });
  });
});
