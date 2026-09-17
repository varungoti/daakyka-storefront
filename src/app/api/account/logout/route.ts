import { NextResponse } from "next/server";
import { destroyCustomerSession } from "@/lib/customer-auth/session";

export async function POST() {
  await destroyCustomerSession();
  return NextResponse.json({ ok: true });
}
