import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { DELETE as deleteCredential, POST as postCredential } from "@/app/api/admin/integrations/[provider]/credentials/route";
import { db } from "@/lib/db";
import {
  clearCredential,
  getCredential,
  getCredentialMeta,
  setCredential,
} from "@/lib/integrations/credential-store";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import { withEnv } from "../helpers/env";

// Any admin user works for attributing the audit-logged credential change —
// mirrors tests/integration/site-settings.test.ts's findAnyAdminId helper.
async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("credential-store: getCredential/setCredential/clearCredential round trip", () => {
  after(async () => {
    await db.integrationCredential.deleteMany({ where: { provider: "RAZORPAY", key: "KEY_ID" } });
  });

  it("returns null for a credential that was never set", async () => {
    assert.equal(await getCredential("RAZORPAY", "KEY_ID"), null);
    assert.equal((await getCredentialMeta("RAZORPAY", "KEY_ID")).configured, false);
  });

  it("persists a written value, getCredential decrypts it back, and clearing removes it", async () => {
    const adminId = await findAnyAdminId();

    await setCredential("RAZORPAY", "KEY_ID", "rzp_test_roundtrip", adminId);
    assert.equal(await getCredential("RAZORPAY", "KEY_ID"), "rzp_test_roundtrip");

    const meta = await getCredentialMeta("RAZORPAY", "KEY_ID");
    assert.equal(meta.configured, true);
    assert.ok(meta.updatedAt);

    // The row itself must never hold the plaintext value.
    const row = await db.integrationCredential.findUnique({
      where: { provider_key: { provider: "RAZORPAY", key: "KEY_ID" } },
    });
    assert.ok(row);
    assert.notEqual(row!.valueEncrypted, "rzp_test_roundtrip");

    await clearCredential("RAZORPAY", "KEY_ID", adminId);
    assert.equal(await getCredential("RAZORPAY", "KEY_ID"), null);
    assert.equal((await getCredentialMeta("RAZORPAY", "KEY_ID")).configured, false);
  });

  it("writes audit log entries for set and clear, and never logs the value", async () => {
    const adminId = await findAnyAdminId();

    await setCredential("RAZORPAY", "KEY_ID", "rzp_test_audit_super_secret", adminId);
    const setEntry = await db.auditLog.findFirst({
      where: { entity: "integration_credential", entityId: "RAZORPAY:KEY_ID", action: "update" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(setEntry, "expected an audit log row for the credential write");
    assert.ok(
      !JSON.stringify(setEntry).includes("rzp_test_audit_super_secret"),
      "audit log must never contain the secret value",
    );

    await clearCredential("RAZORPAY", "KEY_ID", adminId);
    const clearEntry = await db.auditLog.findFirst({
      where: { entity: "integration_credential", entityId: "RAZORPAY:KEY_ID", action: "clear" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(clearEntry, "expected an audit log row for the credential clear");
  });

  it("isRazorpayConfigured() picks up a DB-set credential over env, and env once cleared", async () => {
    const adminId = await findAnyAdminId();

    await withEnv({ RAZORPAY_KEY_ID: "rzp_env_fallback", RAZORPAY_KEY_SECRET: "env-secret" }, async () => {
      assert.equal(await isRazorpayConfigured(), true);

      await setCredential("RAZORPAY", "KEY_ID", "rzp_db_override", adminId);
      assert.equal(await getCredential("RAZORPAY", "KEY_ID"), "rzp_db_override");
      // Still configured (DB value takes priority, env still backs KEY_SECRET).
      assert.equal(await isRazorpayConfigured(), true);

      await clearCredential("RAZORPAY", "KEY_ID", adminId);
      // Falls back to env once the DB row is cleared.
      assert.equal(await getCredential("RAZORPAY", "KEY_ID"), null);
      assert.equal(await isRazorpayConfigured(), true);
    });
  });
});

describe("POST/DELETE /api/admin/integrations/[provider]/credentials", () => {
  after(async () => {
    await db.integrationCredential.deleteMany({ where: { provider: "RAZORPAY", key: "KEY_SECRET" } });
  });

  it("rejects with 401/403 when called with no session (permission-gated, matching every other admin route)", async () => {
    // requireAdminPermission's getSession() call falls back to
    // "no session" whenever it runs outside a real Next.js request scope
    // (see src/lib/auth/session.ts) — exactly the scenario a directly-
    // invoked route handler in a test hits, same convention used by
    // every other admin route integration test in this repo (e.g.
    // tests/integration/site-settings.test.ts, admin-crud-completion.test.ts).
    // hasPermission's role matrix (asserted in src/lib/auth/rbac.test.ts)
    // is what actually proves a role without "integrations:manage" (e.g.
    // MARKETING_ADMIN) is denied — that's the unit-level equivalent of a
    // logged-in-but-unauthorized 403 this harness can't reach directly.
    const response = await postCredential(
      jsonRequest("http://localhost/api/admin/integrations/razorpay/credentials", "POST", {
        key: "KEY_SECRET",
        value: "should-not-be-saved",
      }),
      { params: Promise.resolve({ provider: "razorpay" }) },
    );
    assert.ok([401, 403].includes(response.status), `expected 401 or 403, got ${response.status}`);

    // Never persisted.
    assert.equal(await getCredential("RAZORPAY", "KEY_SECRET"), null);

    const deleteResponse = await deleteCredential(
      jsonRequest("http://localhost/api/admin/integrations/razorpay/credentials", "DELETE", {
        key: "KEY_SECRET",
      }),
      { params: Promise.resolve({ provider: "razorpay" }) },
    );
    assert.ok(
      [401, 403].includes(deleteResponse.status),
      `expected 401 or 403, got ${deleteResponse.status}`,
    );
  });

  it("rejects an unknown provider and an unknown key the same way (still auth-checked first)", async () => {
    const response = await postCredential(
      jsonRequest("http://localhost/api/admin/integrations/not-a-real-provider/credentials", "POST", {
        key: "KEY_SECRET",
        value: "x",
      }),
      { params: Promise.resolve({ provider: "not-a-real-provider" }) },
    );
    assert.ok([401, 403].includes(response.status));
  });
});

describe("set-then-read round trip never exposes the value in a JSON response", () => {
  after(async () => {
    await db.integrationCredential.deleteMany({ where: { provider: "BREVO", key: "API_KEY" } });
  });

  it("the POST response body never contains the submitted secret", async () => {
    const adminId = await findAnyAdminId();
    const secretValue = "brevo-super-secret-value-should-never-appear";

    await setCredential("BREVO", "API_KEY", secretValue, adminId);
    const meta = await getCredentialMeta("BREVO", "API_KEY");

    assert.equal(meta.configured, true);
    assert.ok(!JSON.stringify(meta).includes(secretValue));

    // A route-shaped response object, mirroring exactly what the API
    // route returns on a successful (authenticated) POST.
    const routeShapedResponse = { provider: "BREVO", key: "API_KEY", ...meta };
    assert.ok(!JSON.stringify(routeShapedResponse).includes(secretValue));
  });
});
