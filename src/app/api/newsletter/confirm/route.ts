import { NextResponse } from "next/server";
import { confirmNewsletterSubscriber } from "@/lib/engagement/newsletter";

/**
 * What the confirmation email's link points at. Redirects to
 * /newsletter/confirmed with a `status` query param rather than returning
 * JSON, since this is meant to be clicked directly from an email client.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const result = token
    ? await confirmNewsletterSubscriber(token)
    : ({ ok: false, error: "Missing confirmation token" } as const);

  const redirectUrl = new URL("/newsletter/confirmed", request.url);
  redirectUrl.searchParams.set("status", result.ok ? "ok" : "invalid");
  return NextResponse.redirect(redirectUrl);
}
