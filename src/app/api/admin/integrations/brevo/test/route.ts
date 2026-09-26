import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { sendEmail } from "@/lib/engagement/providers/email";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";

/**
 * F-267: the only existing way to prove a saved Brevo key actually works
 * end to end was the template editor's "Send test" button — gated by
 * engagement:manage (a different permission than saving credentials),
 * buried on a different admin page, and only reachable once a template
 * already exists. This gives the Integrations page its own "send a test
 * email to me" action, gated by the same integrations:manage permission
 * saving a credential already requires.
 *
 * Mirrors src/app/api/admin/templates/[id]/send-test/route.ts's contract:
 * a configuration/provider failure is reported as {ok:false, error} with a
 * 200, not a thrown error, since "the test failed and told you why" is the
 * whole point of this endpoint, not a server error.
 */
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "admin-integration-brevo-test", 5, 60_000);
  if (limited) return limited;

  const { session, error } = await requireAdminPermission("integrations:manage");
  if (error) return error;

  try {
    const result = await sendEmail({
      to: session!.email,
      subject: "DAAKYKA Brevo test email",
      html:
        "<p>This is a test email from the DAAKYKA admin Integrations page.</p>" +
        "<p>If this reached you, Brevo is configured and enabled correctly.</p>",
      text: "This is a test email from the DAAKYKA admin Integrations page. If this reached you, Brevo is configured and enabled correctly.",
    });

    if (!result.ok) {
      console.warn(`[integrations.brevo.test] test email not sent: ${result.error}`);
      return NextResponse.json({ ok: false, error: result.error ?? "Email not sent" }, { status: 200 });
    }

    return NextResponse.json({ ok: true, provider: result.provider, sentTo: session!.email });
  } catch (err) {
    console.error("[integrations.brevo.test] unexpected error sending test email", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Send failed" },
      { status: 200 },
    );
  }
}
