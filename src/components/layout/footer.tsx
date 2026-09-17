import { brand } from "@/data/brand";
import { buildFooterLinks, type FooterColumn } from "@/lib/navigation/build-footer-links";
import { NewsletterSignup } from "@/components/layout/newsletter-signup";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";

/**
 * Phase C6: a clean four-column footer over the C1 light tokens.
 *
 * Contact details and the sale/page-visibility flags are settings-backed
 * (SiteSetting via getSetting()/isPageEnabled()/isSaleEnabled()), but the
 * read happens once in the server-rendered src/app/layout.tsx and flows
 * down as props through SiteShell — the same pattern used for the utility
 * bar's announcement/contact/bulk-CTA props (see announcement-bar.tsx) —
 * rather than making this component itself async. That keeps Footer a
 * plain, easily-previewable component while still being fully DB-driven at
 * the root. The link-shaping logic lives in the pure, unit-tested
 * buildFooterLinks() helper (src/lib/navigation/get-footer-links.ts).
 */
export function Footer({
  fabricTechEnabled,
  mixMatchEnabled,
  saleEnabled,
  contactPhone,
  contactWhatsapp,
  contactEmail,
  contactAddress,
}: {
  fabricTechEnabled: boolean;
  mixMatchEnabled: boolean;
  saleEnabled: boolean;
  contactPhone: string;
  contactWhatsapp: string;
  contactEmail: string;
  contactAddress: string;
}) {
  const footerLinks = buildFooterLinks({ fabricTechEnabled, mixMatchEnabled, saleEnabled });
  const whatsappHref = `https://wa.me/${contactWhatsapp.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
    brand.web.whatsappMessage,
  )}`;

  return (
    <footer className="border-t border-border bg-alt-surface">
      <div className="mx-auto max-w-[1320px] px-4 py-12 md:py-16 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div className="space-y-5">
            <div>
              <p className="font-display text-2xl font-bold text-ink">
                DAAKYKA <span className="text-brand">APPARELS</span>
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand">
                by {brand.legalName}
              </p>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
                {brand.description} Premium medical scrubs and institutional uniforms —{" "}
                {brand.location.serviceArea} delivery.
              </p>
            </div>

            <ul className="space-y-3 text-sm text-muted">
              <li className="flex items-start gap-3">
                <MapPin size={18} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <span>{contactAddress}</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone size={18} className="shrink-0 text-brand" aria-hidden />
                <a href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`} className="hover:text-brand">
                  {contactPhone}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <MessageCircle size={18} className="shrink-0 text-brand" aria-hidden />
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand"
                >
                  WhatsApp Us
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail size={18} className="shrink-0 text-brand" aria-hidden />
                <a href={`mailto:${contactEmail}`} className="hover:text-brand">
                  {contactEmail}
                </a>
              </li>
            </ul>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            <FooterColumnList column={footerLinks.shop} />
            <FooterColumnList column={footerLinks.help} />
            <FooterColumnList column={footerLinks.company} />
          </div>
        </div>

        <div className="mt-12 grid gap-6 rounded-2xl border border-border bg-surface p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="font-display text-xl font-bold text-ink">Stay Updated</p>
            <p className="mt-2 text-sm text-muted">
              New collections, fabric technology updates, and institutional uniform insights.
            </p>
          </div>
          <NewsletterSignup />
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-8 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {brand.legalName} · {brand.name}. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy-policy" className="hover:text-brand">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-brand">
              Terms of Service
            </Link>
            <Link href="/accessibility" className="hover:text-brand">
              Accessibility
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumnList({ column }: { column: FooterColumn }) {
  return (
    <div>
      <p className="font-display text-sm font-bold uppercase tracking-[0.15em] text-ink">
        {column.title}
      </p>
      <ul className="mt-4 space-y-3">
        {column.links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-muted transition hover:text-brand">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
