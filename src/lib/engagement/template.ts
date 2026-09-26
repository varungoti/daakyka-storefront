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

/** F-270 fix: this used to fall back to the email local part
 * (`email.split("@")[0]`) when no real name was known, so a subscriber with
 * no name on file was greeted "Hi dr.priya.k1987" instead of something
 * generic. A local part is not a name — falling back to "there" instead. */
export function extractFirstName(name?: string): string {
  if (name?.trim()) return name.trim().split(" ")[0] ?? name;
  return "there";
}

/** F-270 fix: every other site-URL helper in this codebase (mailer.ts,
 * unsubscribe.ts, notify.ts, newsletter.ts) strips a trailing slash before
 * building a link — this one didn't, so a NEXT_PUBLIC_SITE_URL ending in
 * "/" combined with a template's "{{shop_url}}/shop" rendered the broken
 * "https://shop.example.com//shop". */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function buildEngagementVars(context: TemplateVars): TemplateVars {
  const shopUrl = stripTrailingSlash(
    context.shopUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com",
  );
  return {
    ...context,
    shop_url: shopUrl,
    first_name: context.first_name ?? context.firstName ?? extractFirstName(context.contactName),
    contact_name: context.contact_name ?? context.contactName ?? context.firstName ?? "there",
    organization: context.organization ?? "your organization",
  };
}

/**
 * F-270 fix: campaign/journey email bodies are wrapped in a single `<p>`
 * with `<br/>` line breaks (see campaign-dispatcher.ts and journey-
 * engine.ts) — a bare "https://..." in the source text stayed plain text
 * instead of becoming a clickable link. Runs AFTER escapeHtmlValue (so it
 * only ever matches a URL's own characters, never something injected via
 * `&lt;`/`&gt;`), and only on http(s) URLs.
 */
export function autoLinkUrls(html: string): string {
  return html.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (url) => `<a href="${url}">${url}</a>`);
}
