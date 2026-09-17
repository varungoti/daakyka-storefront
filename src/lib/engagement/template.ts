export type TemplateVars = Record<string, string | undefined>;

export interface RenderTemplateOptions {
  /**
   * engagement_compliance: HTML-escape (`&`, `<`, `>`) each *substituted*
   * value — never the template's own static markup — before it's spliced
   * in. A customer-controlled value (name, organization, etc.) that
   * contains `<script>` or a stray tag can't inject markup into an
   * EMAIL-channel send this way. Defaults to `false` so existing callers
   * (and WhatsApp's plain-text templates, which have no HTML to protect)
   * are unaffected; EMAIL-channel senders must opt in explicitly.
   */
  escapeHtml?: boolean;
}

function escapeHtmlValue(value: string): string {
  // Order matters: `&` must be escaped first, or the `&` introduced by the
  // `<`/`>` replacements below would itself get escaped on a second pass.
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderTemplate(
  template: string,
  context: TemplateVars,
  options: RenderTemplateOptions = {},
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = context[key] ?? "";
    return options.escapeHtml ? escapeHtmlValue(value) : value;
  });
}

export function extractFirstName(email: string, name?: string): string {
  if (name?.trim()) return name.split(" ")[0] ?? name;
  return email.split("@")[0] ?? "there";
}

export function buildEngagementVars(context: TemplateVars): TemplateVars {
  const shopUrl = context.shopUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com";
  return {
    ...context,
    shop_url: shopUrl,
    first_name:
      context.first_name ??
      context.firstName ??
      (context.email ? extractFirstName(context.email, context.contactName) : "there"),
    contact_name: context.contact_name ?? context.contactName ?? context.firstName ?? "there",
    organization: context.organization ?? "your organization",
  };
}
