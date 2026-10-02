import { NextResponse } from "next/server";
import { confirmEmailChange } from "@/lib/customer-auth/email-change";

/**
 * F-315: the link emailed to the NEW address by ../route.ts. Public on
 * purpose — the signed token is the credential, and the person clicking may
 * not be signed in in this browser. Applying the change signs the account
 * out everywhere, so a success lands on the sign-in page (returning to the
 * profile); a bad or expired link lands on the profile page, which asks for
 * a fresh request after sign-in.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const result = token ? await confirmEmailChange(token) : { ok: false as const, error: "Missing token" };

  const destination = result.ok
    ? "/account/login?returnTo=%2Faccount%2Fprofile&emailChanged=1"
    : "/account/profile?emailChange=invalid";
  return NextResponse.redirect(new URL(destination, request.url));
}
