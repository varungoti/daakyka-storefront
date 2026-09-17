import { redirect } from "next/navigation";
import { SiteSettingToggle } from "@/components/admin/site-setting-toggle";
import {
  AnnouncementEditor,
  ContactEditor,
  ShippingEditor,
} from "@/components/admin/site-controls-editors";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";

export default async function SiteControlsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "settings:manage")) {
    redirect("/admin/dashboard");
  }

  const [
    fabricTechEnabled,
    mixMatchEnabled,
    saleEnabled,
    bulkCtaEnabled,
    announcementMessages,
    flatRate,
    freeAbove,
    phone,
    whatsapp,
    email,
    address,
  ] = await Promise.all([
    getSetting("pages.fabricTech.enabled"),
    getSetting("pages.mixMatch.enabled"),
    getSetting("sale.enabled"),
    getSetting("header.bulkCta.enabled"),
    getSetting("announcement.messages"),
    getSetting("shipping.flatRate"),
    getSetting("shipping.freeAbove"),
    getSetting("contact.phone"),
    getSetting("contact.whatsapp"),
    getSetting("contact.email"),
    getSetting("contact.address"),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Site Controls</h1>
        <p className="text-muted">
          Toggle storefront pages and sections on or off, and manage announcement, contact, and
          shipping details shown across the site. Changes apply within a few minutes.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Pages &amp; sections</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <SiteSettingToggle
            settingKey="pages.fabricTech.enabled"
            enabled={fabricTechEnabled}
            label="Fabric Technology page"
          />
          <SiteSettingToggle
            settingKey="pages.mixMatch.enabled"
            enabled={mixMatchEnabled}
            label="Mix & Match page"
          />
          <SiteSettingToggle settingKey="sale.enabled" enabled={saleEnabled} label="Sale section" />
          <SiteSettingToggle
            settingKey="header.bulkCta.enabled"
            enabled={bulkCtaEnabled}
            label="Header Bulk Order CTA"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Content</h2>
        <div className="grid gap-4">
          <AnnouncementEditor initialMessages={announcementMessages} />
          <ContactEditor initial={{ phone, whatsapp, email, address }} />
          <ShippingEditor initial={{ flatRate, freeAbove }} />
        </div>
      </section>
    </div>
  );
}
