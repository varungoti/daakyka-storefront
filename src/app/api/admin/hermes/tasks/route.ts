import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { dispatchHermesTask } from "@/lib/hermes/client";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const schema = z.object({
  type: z.string().min(2),
  input: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("hermes:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task payload" }, { status: 400 });
  }

  const task = await db.hermesTask.create({
    data: {
      type: parsed.data.type,
      status: "RUNNING",
      input: JSON.stringify(parsed.data.input ?? {}),
    },
  });

  const result = await dispatchHermesTask({
    type: parsed.data.type,
    input: parsed.data.input,
  });

  const completed = await db.hermesTask.update({
    where: { id: task.id },
    data: {
      status: result.ok ? "COMPLETED" : "FAILED",
      output: result.output ?? result.error ?? null,
      completedAt: new Date(),
    },
  });

  if (result.ok && result.output) {
    await db.hermesApproval.create({
      data: {
        taskId: task.id,
        type: parsed.data.type,
        title: `Hermes: ${parsed.data.type.replace(/_/g, " ")}`,
        summary: "Task completed — review output before any publish action.",
        payload: result.output,
        status: "PENDING",
      },
    });
  }

  await logAuditEvent({
    userId: session!.id,
    action: "dispatch",
    entity: "hermes_task",
    entityId: task.id,
    metadata: { type: parsed.data.type, ok: result.ok },
  });

  return NextResponse.json({ task: completed, result });
}
