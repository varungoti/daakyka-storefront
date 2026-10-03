import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { recoverProductionAdmin, ADMIN_RECOVERY_MARKER_KEY } from "./admin-recovery";
import { db } from "../src/lib/db";

describe("one-time production admin recovery", () => {
  it("stays inert outside production and resets only the configured SUPER_ADMIN once", async () => {
    const email = `recovery-${randomBytes(8).toString("hex")}@example.invalid`;
    const oldPassword = randomBytes(22).toString("base64url");
    const temporaryPassword = randomBytes(24).toString("base64url");
    const user = await db.user.create({
      data: {
        email,
        name: "Recovery test",
        role: "SUPER_ADMIN",
        passwordHash: await bcrypt.hash(oldPassword, 12),
        active: false,
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 60_000),
        sessionVersion: 3,
      },
    });
    const config = {
      vercelEnvironment: "preview",
      configuredAdminEmail: email,
      recoveryEmail: email,
      recoveryFlag: "2026-10-03",
      temporaryPassword,
    };
    try {
      assert.equal(await recoverProductionAdmin(db, config), false);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 3);
      await assert.rejects(
        recoverProductionAdmin(db, { ...config, vercelEnvironment: "production", recoveryEmail: "other@example.invalid" }),
        /must match/,
      );
      assert.equal(await recoverProductionAdmin(db, { ...config, vercelEnvironment: "production" }), true);
      const recovered = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(recovered.active, true);
      assert.equal(recovered.failedLoginCount, 0);
      assert.equal(recovered.lockedUntil, null);
      assert.equal(recovered.mustChangePassword, true);
      assert.equal(recovered.sessionVersion, 4);
      assert.equal(await bcrypt.compare(temporaryPassword, recovered.passwordHash), true);
      assert.equal(await bcrypt.compare(oldPassword, recovered.passwordHash), false);
      assert.equal(await recoverProductionAdmin(db, { ...config, vercelEnvironment: "production" }), false);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 4);
      const audit = await db.auditLog.findFirst({ where: { userId: user.id, action: "password_reset" } });
      assert.ok(audit);
      assert.doesNotMatch(audit.metadata ?? "", new RegExp(temporaryPassword));
    } finally {
      await db.siteSetting.deleteMany({ where: { key: ADMIN_RECOVERY_MARKER_KEY } });
      await db.auditLog.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
