import { db } from "@/lib/db";

export async function logAuditEvent(input: {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
