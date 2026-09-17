import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { CustomerNotFoundError, getCustomerForAdmin, setCustomerActive } from "@/lib/customers/admin-customers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const customerUpdateSchema = z.object({ active: z.boolean() });

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("customers:view");
  if (error) return error;

  const { id } = await params;
  try {
    const customer = await getCustomerForAdmin(id);
    return NextResponse.json({ customer });
  } catch (err) {
    if (err instanceof CustomerNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("customers:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = customerUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const customer = await setCustomerActive(id, parsed.data.active, session.id);
    return NextResponse.json({ customer });
  } catch (err) {
    if (err instanceof CustomerNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    throw err;
  }
}
