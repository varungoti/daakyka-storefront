import { brand } from "@/data/brand";
import { footerLinks } from "@/data/navigation";
import { NewsletterSignup } from "@/components/layout/newsletter-signup";
import { Globe, MapPin, Share2, Users, Video } from "lucide-react";
import Link from "next/link";

const socialIcons = [Share2, Globe, Users, Video];

export function Footer() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto max-w-7xl px-4 py-16 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div className="space-y-6">
            <div>
              <p className="font-display text-2xl font-extrabold text-ink">
                DAAKYKA <span className="text-brand">APPARELS</span>
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand">
                by {brand.legalName}
              </p>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
                {brand.description} Premium medical scrubs and institutional uniforms —
                {brand.location.serviceArea} delivery.
              </p>
            </div>

            <div className="flex items-start gap-3 text-sm text-muted">
              <MapPin size={18} className="mt-0.5 shrink-0 text-brand" />
              <p>{brand.location.addressLine}</p>
            </div>

            <div className="flex items-center gap-3">
              {socialIcons.map((Icon, index) => (
                <a
                  key={index}
                  href={brand.web.domain}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border p-2.5 text-muted transition hover:border-brand hover:text-brand"
                  aria-label="Social link"
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <FooterColumn title="Shop" links={footerLinks.shop} />
            <FooterColumn title="Company" links={footerLinks.company} />
            <FooterColumn title="Customer Care" links={footerLinks.support} />
            <FooterColumn title="Legal" links={footerLinks.legal} />
          </div>
        </div>

        <div className="mt-12 grid gap-6 rounded-3xl border border-border bg-lavender/40 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
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
          <div className="flex flex-wrap gap-3">
            {["Visa", "Mastercard", "UPI", "Razorpay", "PayPal"].map((method) => (
              <span key={method} className="rounded-full border border-border px-3 py-1 text-xs">
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="font-display text-sm font-bold uppercase tracking-[0.15em] text-ink">
        {title}
      </p>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
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
