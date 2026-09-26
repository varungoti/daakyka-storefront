import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { sendEmail } from "@/lib/engagement/providers/email";
import { buildEngagementVars, renderTemplate } from "@/lib/engagement/template";
import { getTemplateForAdmin, TemplateNotFoundError } from "@/lib/engagement/templates";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// F-217: {subject, body} are both optional — an empty/absent request body
// (the pre-existing caller) still works exactly as before, testing the
// saved template.
const sendTestSchema = z.object({
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
});

/** F-217: which subject/body a test send actually renders — the override
 * (this request's, possibly-unsaved, form values) takes priority over the
 * saved template, so testing a not-yet-saved edit doesn't silently test
 * the old copy instead. Exported standalone so this precedence is
 * unit-testable without a real admin session, which requireAdminPermission
 * needs a real Next.js request scope for (see tests/integration/
 * admin-crud-completion.test.ts's header comment). */
export function resolveTestSendSource(
  template: { name: string; subject: string | null; body: string },
  overrides: { subject?: string; body?: string },
): { subject: string; body: string } {
  const subjectSource = overrides.subject ?? template.subject;
  return {
    subject: subjectSource ? subjectSource : `[Test] ${template.name}`,
    body: overrides.body ?? template.body,
  };
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
export async function POST(request: Request, { params }: RouteParams) {
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

  // F-217: this used to always render the *saved* row, so testing an edit
  // you hadn't saved yet silently sent the old copy instead — see
  // template-form.tsx, which now posts the form's current, possibly-
  // unsaved subject/body here. A genuinely empty request (no body at all —
  // the old caller's shape, and this route's own contract for anyone else
  // hitting it directly) still tests the saved template exactly as before;
  // readJsonBody's Content-Type gate only kicks in once there's an actual
  // body to parse (`request.body` is only non-null when one was supplied —
  // unlike the content-length header, which fetch's Request doesn't
  // populate for a body given directly to its constructor), so that gate
  // stays in place as the CSRF mitigation it's meant to be rather than
  // being bypassed here.
  let overrides: { subject?: string; body?: string } = {};
  if (request.body !== null) {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = sendTestSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    overrides = parsed.data;
  }

  const vars = buildEngagementVars({
    email: session!.email,
    first_name: session!.name.split(" ")[0],
    contact_name: session!.name,
    organization: "DAAKYKA Apparels (test send)",
  });

  const testSendSource = resolveTestSendSource(template, overrides);
  const subject = renderTemplate(testSendSource.subject, vars);
  const bodyHtml = renderTemplate(testSendSource.body, vars).replace(/\n/g, "<br />");

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
