export type TemplateVars = Record<string, string | undefined>;

export function renderTemplate(template: string, context: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? "");
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
