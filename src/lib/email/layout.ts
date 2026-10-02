import { brand } from "@/data/brand";
import { formatInrExact } from "@/lib/currency/admin-money";
import { escapeHtml, htmlToText } from "@/lib/email/html";
import { getSetting } from "@/lib/settings";

/**
 * F-041: every transactional email used to be one unbranded paragraph with
 * no header, no store contact details and no footer, and a plain-text part
 * that lost every link. This is the shared shell they now all go through:
 * a table-based layout with inline styles (many mail clients ignore <style>
 * blocks and flexbox), the store wordmark, and a footer built from the same
 * admin-editable settings the site footer uses — nothing here invents a
 * store detail: the GSTIN line, in particular, is omitted until the owner
 * has actually entered one.
 */

/** Same base URL fallback the other mailers use (see
 * src/lib/customer-auth/mailer.ts, src/lib/engagement/unsubscribe.ts). */
export function emailSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com").replace(/\/$/, "");
}

export interface EmailFooter {
  storeName: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  /** Empty until the owner enters one — then the footer line is omitted. */
  gstin: string;
}

/** Footer facts from the admin-editable site settings (getSetting never
 * throws — a failed read falls back to the documented defaults). */
export async function loadEmailFooter(): Promise<EmailFooter> {
  const [address, phone, email, gstin] = await Promise.all([
    getSetting("contact.address"),
    getSetting("contact.phone"),
    getSetting("contact.email"),
    getSetting("legal.gstin"),
  ]);
  return { storeName: brand.name, legalName: brand.legalName, address, phone, email, gstin };
}

/** Money for an email body: `₹1,198.00` (Indian digit grouping, always
 * with paise so a column of amounts lines up), not `INR 1198.00`. A
 * non-INR order currency (not produced by checkout today) falls back to the
 * ISO code in front of the amount rather than guessing a symbol. */
export function formatEmailMoney(amount: number, currency = "INR"): string {
  if (currency.toUpperCase() === "INR") return formatInrExact(amount, { alwaysShowPaise: true });
  return `${currency.toUpperCase()} ${(Math.round(amount * 100) / 100).toFixed(2)}`;
}

export const EMAIL_COLORS = {
  brand: "#8a347d",
  ink: "#1a1a2e",
  muted: "#6b6475",
  border: "#e8e2ec",
  surface: "#f6f3f8",
} as const;

const FONT = "Arial,Helvetica,sans-serif";

export interface EmailLayoutInput {
  /** Becomes the document <title> and the inbox preview line. */
  subject: string;
  /** Large heading at the top of the body, optional. */
  heading?: string;
  /** Hidden preview text some inboxes show beside the subject. */
  preheader?: string;
  /** Already-escaped HTML for the body. */
  bodyHtml: string;
  /** Explicit plain-text body (with the URLs written out). When omitted it
   * is derived from `bodyHtml`, which keeps every link as `label (url)`. */
  bodyText?: string;
  footer: EmailFooter;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.55;color:${EMAIL_COLORS.ink};">${html}</p>`;
}

export function button(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;"><tr><td style="background:${EMAIL_COLORS.brand};border-radius:6px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function footerLines(footer: EmailFooter): { html: string; text: string } {
  const htmlLines = [
    `<strong>${escapeHtml(footer.storeName)}</strong>`,
    footer.address ? escapeHtml(footer.address) : "",
    [footer.phone ? `Phone: ${escapeHtml(footer.phone)}` : "", footer.email ? `Email: ${escapeHtml(footer.email)}` : ""]
      .filter(Boolean)
      .join(" &middot; "),
    `${escapeHtml(footer.legalName)}${footer.gstin ? ` &middot; GSTIN ${escapeHtml(footer.gstin)}` : ""}`,
  ].filter(Boolean);
  const textLines = [
    footer.storeName,
    footer.address,
    [footer.phone ? `Phone: ${footer.phone}` : "", footer.email ? `Email: ${footer.email}` : ""].filter(Boolean).join(" | "),
    `${footer.legalName}${footer.gstin ? ` | GSTIN ${footer.gstin}` : ""}`,
  ].filter(Boolean);
  return { html: htmlLines.join("<br>"), text: textLines.join("\n") };
}

/** Wraps a body in the branded shell and returns both MIME parts. */
export function renderEmailLayout(input: EmailLayoutInput): { html: string; text: string } {
  const footer = footerLines(input.footer);
  const heading = input.heading
    ? `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;color:${EMAIL_COLORS.ink};">${escapeHtml(input.heading)}</h1>`
    : "";
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.surface};">${preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_COLORS.surface};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${EMAIL_COLORS.border};border-radius:8px;">
<tr><td style="background:${EMAIL_COLORS.brand};padding:18px 24px;border-radius:8px 8px 0 0;"><a href="${escapeHtml(emailSiteUrl())}" style="font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:0.5px;color:#ffffff;text-decoration:none;">${escapeHtml(input.footer.storeName)}</a></td></tr>
<tr><td style="padding:24px;">${heading}${input.bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${EMAIL_COLORS.border};font-family:${FONT};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};">${footer.html}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const bodyText = input.bodyText ?? htmlToText(input.bodyHtml);
  const text = [input.heading, bodyText, `--\n${footer.text}`].filter(Boolean).join("\n\n");

  return { html, text };
}
