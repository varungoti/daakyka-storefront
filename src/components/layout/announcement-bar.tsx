"use client";

import { announcementItems } from "@/data/navigation";
import { cn } from "@/lib/utils";
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
    <div className="bg-brand-violet py-1.5 text-xs font-medium tracking-wide text-white md:py-2.5 md:text-sm">
      {/* F-085/F-242: below `md` this is one non-wrapping row — the first
          announcement (clamped to two lines) on the left, the Bulk Order
          button on the right — about 40-44px tall. It used to `flex-wrap`
          unconditionally, so on a phone the button took a row of its own
          and every message wrapped onto yet another row (the separator
          bullet is already `hidden` below `md`), a ~110px band above the
          header on every page before a shopper saw anything else. From
          `md` up this is the same wrapping row with every message as
          before. */}
      <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-x-3 px-4 md:flex-wrap md:gap-x-4 md:gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1 md:flex-initial md:flex-wrap md:justify-center">
          {items.map((item, index) => (
            <span key={item} className={cn("items-center gap-4", index > 0 ? "hidden md:flex" : "flex")}>
              <span className="line-clamp-2 md:line-clamp-none">{item}</span>
              {index < items.length - 1 && (
                <span className="hidden text-white/50 md:inline">•</span>
              )}
            </span>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3">
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
              className="whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:opacity-90 md:px-3.5 md:text-xs"
            >
              Bulk Order Enquiry
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
