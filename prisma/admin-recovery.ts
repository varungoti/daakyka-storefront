import { isInsecureSeedPassword } from "../src/lib/auth/seed-defaults";
import type { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

export const ADMIN_RECOVERY_MARKER_KEY = "seed.adminRecovery20261003";

type RecoveryConfig = {
  vercelEnvironment?: string;
  configuredAdminEmail: string;
  recoveryEmail?: string;
  recoveryFlag?: string;
  temporaryPassword?: string;
};

/** Deliberately inert without three explicit production-only environment values. */
export async function recoverProductionAdmin(db: PrismaClient, config: RecoveryConfig): Promise<boolean> {
  if (config.vercelEnvironment !== "production" || config.recoveryFlag !== "2026-10-03") return false;
  if (!config.recoveryEmail || !config.temporaryPassword) {
    throw new Error("Admin recovery is enabled but its email or temporary password is missing");
  }
  const email = config.recoveryEmail.trim().toLowerCase();
  if (email !== config.configuredAdminEmail.trim().toLowerCase()) {
    throw new Error("Admin recovery email must match the configured seed admin email");
  }
  if (isInsecureSeedPassword(config.temporaryPassword)) {
    throw new Error("Admin recovery requires a unique temporary password of at least 12 characters");
  }
  if (await db.siteSetting.findUnique({ where: { key: ADMIN_RECOVERY_MARKER_KEY } })) return false;

  const admin = await db.user.findUnique({ where: { email } });
  if (!admin || admin.role !== "SUPER_ADMIN") {
    throw new Error("Admin recovery target must be an existing SUPER_ADMIN");
  }

  const passwordHash = await bcrypt.hash(config.temporaryPassword, 12);
  // A single database transaction makes the password reset, session
  // revocation, audit trail, and replay marker inseparable. A concurrent
  // build losing the unique marker race rolls back its reset as well.
  await db.$transaction([
    db.user.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        active: true,
        failedLoginCount: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
        sessionVersion: { increment: 1 },
        mustChangePassword: true,
      },
    }),
    db.auditLog.create({
      data: {
        userId: admin.id,
        action: "password_reset",
        entity: "user",
        entityId: admin.id,
        actorRole: "SYSTEM",
        actorEmail: "production-seed-recovery",
        metadata: JSON.stringify({ source: "one-time-build-recovery", forcedPasswordChange: true }),
      },
    }),
    db.siteSetting.create({
      data: { key: ADMIN_RECOVERY_MARKER_KEY, value: new Date().toISOString() },
    }),
  ]);
  return true;
}
