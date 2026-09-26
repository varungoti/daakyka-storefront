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
  // F-061 fix: this used to gate the whole page (and every editor on it) on
  // one blanket "settings:manage" — the same permission MARKETING_ADMIN was
  // wrongly granted for its documented sale/announcement-only scope. Now a
  // role with just "settings:marketing" can open the page, but only sees
  // the sections it's actually allowed to change; ContactEditor and
  // ShippingEditor (and the page-visibility toggles) stay store-owner-level.
  const canMarketing = Boolean(session && hasPermission(session.role, "settings:marketing"));
  const canStore = Boolean(session && hasPermission(session.role, "settings:manage"));
  if (!session || (!canMarketing && !canStore)) {
    redirect("/admin/dashboard");
  }

  const [saleEnabled, bulkCtaEnabled, announcementMessages] = await Promise.all([
    getSetting("sale.enabled"),
    getSetting("header.bulkCta.enabled"),
    getSetting("announcement.messages"),
  ]);

  const storeOnlySettings = canStore
    ? await Promise.all([
        getSetting("pages.fabricTech.enabled"),
        getSetting("pages.mixMatch.enabled"),
        getSetting("shipping.flatRate"),
        getSetting("shipping.freeAbove"),
        getSetting("contact.phone"),
        getSetting("contact.whatsapp"),
        getSetting("contact.email"),
        getSetting("contact.address"),
      ])
    : null;
  const [fabricTechEnabled, mixMatchEnabled, flatRate, freeAbove, phone, whatsapp, email, address] =
    storeOnlySettings ?? [false, false, 0, 0, "", "", "", ""];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Site Controls</h1>
        <p className="text-muted">
          {canStore
            ? "Toggle storefront pages and sections on or off, and manage announcement, contact, and shipping details shown across the site. Changes apply within a few minutes."
            : "Manage the sale banner, announcement bar, and header bulk-order CTA. Changes apply within a few minutes."}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Pages &amp; sections</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {canStore ? (
            <>
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
            </>
          ) : null}
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
          {canStore ? (
            <>
              <ContactEditor initial={{ phone, whatsapp, email, address }} />
              <ShippingEditor initial={{ flatRate, freeAbove }} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
