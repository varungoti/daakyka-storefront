"use client";

import { announcementItems } from "@/data/navigation";
import { Phone, MessageCircle } from "lucide-react";
import Link from "next/link";

/** Builds a wa.me deep link from a phone number in any common format
 * (e.g. "+91 95530 94251") — wa.me only accepts digits, no "+" or
 * spaces. */
function whatsappHref(phone: string, message: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Phase C2 utility bar: announcement messages on the left; phone,
 * WhatsApp, and a prominent "Bulk Order Enquiry" CTA on the right (shown
 * only when SiteSetting `header.bulkCta.enabled` is true). The DB reads
 * (announcement.messages, contact.*, header.bulkCta.enabled) happen in
 * src/app/layout.tsx (server) and flow down as props through SiteShell,
 * matching the pattern already used for fabricTechEnabled/mixMatchEnabled.
 */
export function UtilityBar({
  messages,
  phone,
  whatsapp,
  bulkCtaEnabled,
}: {
  messages?: string[];
  phone: string;
  whatsapp: string;
  bulkCtaEnabled: boolean;
}) {
  const items = messages && messages.length > 0 ? messages : announcementItems;
  const waHref = whatsappHref(
    whatsapp,
    "Hi DAAKYKA, I'd like to enquire about uniforms and linens for my organization.",
  );

  return (
    <div className="bg-brand-violet py-2.5 text-xs font-medium tracking-wide text-white md:text-sm">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {items.map((item, index) => (
            <span key={item} className="flex items-center gap-4">
              {item}
              {index < items.length - 1 && (
                <span className="hidden text-white/50 md:inline">•</span>
              )}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`tel:${phone.replace(/[^0-9+]/g, "")}`}
            className="hidden items-center gap-1.5 text-white/90 transition hover:text-white sm:flex"
          >
            <Phone size={13} />
            {phone}
          </a>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 text-white/90 transition hover:text-white sm:flex"
          >
            <MessageCircle size={13} />
            WhatsApp
          </a>
          {bulkCtaEnabled && (
            <Link
              href="/bulk-orders"
              className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:opacity-90 md:text-xs"
            >
              Bulk Order Enquiry
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
