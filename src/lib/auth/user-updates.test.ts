import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserUpdateData,
  isSelfRoleChangeBlocked,
  wouldRemoveLastSuperAdmin,
} from "@/lib/auth/user-updates";

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

describe("isSelfRoleChangeBlocked", () => {
  it("blocks a user from changing their own role", () => {
    assert.equal(isSelfRoleChangeBlocked("user-1", "user-1", "VIEWER", "SUPER_ADMIN"), true);
  });

  it("allows a user to re-save their own current role (no-op)", () => {
    assert.equal(isSelfRoleChangeBlocked("user-1", "user-1", "VIEWER", "VIEWER"), false);
  });

  it("allows an admin to change someone else's role", () => {
    assert.equal(isSelfRoleChangeBlocked("user-2", "user-1", "VIEWER", "SUPER_ADMIN"), false);
  });
});

describe("wouldRemoveLastSuperAdmin", () => {
  it("blocks demoting the last active SUPER_ADMIN", () => {
    const result = wouldRemoveLastSuperAdmin(
      { active: true, role: "SUPER_ADMIN" },
      { name: "X", role: "STORE_OWNER", active: true },
      0,
    );
    assert.equal(result, true);
  });

  it("blocks deactivating the last active SUPER_ADMIN", () => {
    const result = wouldRemoveLastSuperAdmin(
      { active: true, role: "SUPER_ADMIN" },
      { name: "X", role: "SUPER_ADMIN", active: false },
      0,
    );
    assert.equal(result, true);
  });

  it("allows demoting a SUPER_ADMIN when another active one remains", () => {
    const result = wouldRemoveLastSuperAdmin(
      { active: true, role: "SUPER_ADMIN" },
      { name: "X", role: "STORE_OWNER", active: true },
      1,
    );
    assert.equal(result, false);
  });

  it("is a no-op for a non-SUPER_ADMIN user", () => {
    const result = wouldRemoveLastSuperAdmin(
      { active: true, role: "VIEWER" },
      { name: "X", role: "VIEWER", active: false },
      0,
    );
    assert.equal(result, false);
  });

  it("allows re-saving a SUPER_ADMIN as still active SUPER_ADMIN", () => {
    const result = wouldRemoveLastSuperAdmin(
      { active: true, role: "SUPER_ADMIN" },
      { name: "New Name", role: "SUPER_ADMIN", active: true },
      0,
    );
    assert.equal(result, false);
  });

  it("is a no-op when the existing SUPER_ADMIN was already inactive", () => {
    const result = wouldRemoveLastSuperAdmin(
      { active: false, role: "SUPER_ADMIN" },
      { name: "X", role: "VIEWER", active: false },
      0,
    );
    assert.equal(result, false);
  });
});
