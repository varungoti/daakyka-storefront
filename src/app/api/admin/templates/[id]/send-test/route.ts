import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { sendEmail } from "@/lib/engagement/providers/email";
import { buildEngagementVars, renderTemplate } from "@/lib/engagement/template";
import { getTemplateForAdmin, TemplateNotFoundError } from "@/lib/engagement/templates";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * "Send test" button on the template editor (task: admin CRUD completion
 * for engagement templates). Always renders and sends via email — even
 * for a WHATSAPP-channel template — since this is just a preview
 * mechanism for the admin to eyeball rendered {{variables}}, not a real
 * send through that channel's provider (src/lib/engagement/providers/
 * whatsapp.ts). Best-effort: sendEmail() already returns {ok:false,...}
 * rather than throwing when Brevo isn't configured (see providers/
 * email.ts), and we mirror that contract here — this route never 500s
 * just because outbound email isn't set up.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;

  let template;
  try {
    template = await getTemplateForAdmin(id);
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    throw err;
  }

  const vars = buildEngagementVars({
    email: session!.email,
    first_name: session!.name.split(" ")[0],
    contact_name: session!.name,
    organization: "DAAKYKA Apparels (test send)",
  });

  const subject = template.subject ? renderTemplate(template.subject, vars) : `[Test] ${template.name}`;
  const bodyHtml = renderTemplate(template.body, vars).replace(/\n/g, "<br />");

  try {
    const result = await sendEmail({
      to: session!.email,
      subject: `[Test] ${subject}`,
      html: `<p><em>Test send of template "${template.name}" (${template.channel}).</em></p>${bodyHtml}`,
    });

    if (!result.ok) {
      // Not configured / provider error — log and report, never throw.
      console.warn(`[templates.send-test] email not sent for template ${id}: ${result.error}`);
      return NextResponse.json({ ok: false, error: result.error ?? "Email not sent" }, { status: 200 });
    }

    return NextResponse.json({ ok: true, provider: result.provider, sentTo: session!.email });
  } catch (err) {
    console.error(`[templates.send-test] unexpected error sending test for template ${id}`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Send failed" },
      { status: 200 },
    );
  }
}
