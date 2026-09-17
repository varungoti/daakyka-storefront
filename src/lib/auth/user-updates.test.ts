import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUserUpdateData } from "@/lib/auth/user-updates";

describe("buildUserUpdateData (admin session revocation triggers, v1 2.3)", () => {
  it("does not revoke sessions when only the name changes", () => {
    const { data, revokesSessions } = buildUserUpdateData(
      { active: true, role: "VIEWER" },
      { name: "New Name", role: "VIEWER", active: true },
    );
    assert.equal(revokesSessions, false);
    assert.equal(data.sessionVersion, undefined);
  });

  it("does not revoke sessions when re-saving the same role/active values", () => {
    const { revokesSessions } = buildUserUpdateData(
      { active: true, role: "STORE_OWNER" },
      { name: "Same", role: "STORE_OWNER", active: true },
    );
    assert.equal(revokesSessions, false);
  });

  it("revokes sessions when deactivating a previously-active user", () => {
    const { data, revokesSessions } = buildUserUpdateData(
      { active: true, role: "VIEWER" },
      { name: "X", role: "VIEWER", active: false },
    );
    assert.equal(revokesSessions, true);
    assert.deepEqual(data.sessionVersion, { increment: 1 });
  });

  it("does not revoke sessions when re-saving an already-inactive user as inactive", () => {
    const { revokesSessions } = buildUserUpdateData(
      { active: false, role: "VIEWER" },
      { name: "X", role: "VIEWER", active: false },
    );
    assert.equal(revokesSessions, false);
  });

  it("revokes sessions when the role changes", () => {
    const { data, revokesSessions } = buildUserUpdateData(
      { active: true, role: "VIEWER" },
      { name: "X", role: "STORE_OWNER", active: true },
    );
    assert.equal(revokesSessions, true);
    assert.deepEqual(data.sessionVersion, { increment: 1 });
  });

  it("revokes sessions when both role changes and the user is deactivated", () => {
    const { revokesSessions } = buildUserUpdateData(
      { active: true, role: "VIEWER" },
      { name: "X", role: "SUPPORT_AGENT", active: false },
    );
    assert.equal(revokesSessions, true);
  });
});
