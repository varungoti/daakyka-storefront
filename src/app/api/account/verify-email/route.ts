import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/customer-auth/verify-email";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { customerVerifyEmailSchema } from "@/lib/validation/schemas";

// GET supports a plain link click (?token=...) hitting the API directly;
// POST supports the /account/verify-email page (and any future UI)
// submitting the token without it living in query-string history.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const result = await verifyEmailToken(token);
  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: 400 });
}

export async function POST(request: Request) {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = customerVerifyEmailSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await verifyEmailToken(parsed.data.token);
  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: 400 });
}
