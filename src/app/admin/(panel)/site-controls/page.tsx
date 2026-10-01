import { redirect } from "next/navigation";
import { SiteSettingToggle } from "@/components/admin/site-setting-toggle";
import {
  AnnouncementEditor,
  ContactEditor,
  LegalComplianceEditor,
  ShippingEditor,
} from "@/components/admin/site-controls-editors";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getSetting, getSettingUpdatedAt, type SettingKey } from "@/lib/settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Site Controls" };

/** F-343: loads every setting key's `updatedAt` alongside its value in one
 * pass, so each editor/toggle below can send it back on save and get a 409
 * instead of silently overwriting a concurrent edit — see
 * getSettingUpdatedAt()'s doc comment in src/lib/settings. */
async function getUpdatedAtMap<K extends SettingKey>(keys: K[]): Promise<Record<K, Date | null>> {
  const values = await Promise.all(keys.map((key) => getSettingUpdatedAt(key)));
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<K, Date | null>;
}

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

  const [saleEnabled, bulkCtaEnabled, announcementMessages, sharedUpdatedAt] = await Promise.all([
    getSetting("sale.enabled"),
    getSetting("header.bulkCta.enabled"),
    getSetting("announcement.messages"),
    getUpdatedAtMap(["sale.enabled", "header.bulkCta.enabled", "announcement.messages"] as const),
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
        getSetting("grievance.name"),
        getSetting("grievance.designation"),
        getSetting("grievance.phone"),
        getSetting("grievance.email"),
        getSetting("legal.gstin"),
        getSetting("legal.stateCode"),
        getSetting("returns.windowDays"),
      ])
    : null;
  const storeOnlyUpdatedAt = canStore
    ? await getUpdatedAtMap([
        "pages.fabricTech.enabled",
        "pages.mixMatch.enabled",
        "shipping.flatRate",
        "shipping.freeAbove",
        "contact.phone",
        "contact.whatsapp",
        "contact.email",
        "contact.address",
        "grievance.name",
        "grievance.designation",
        "grievance.phone",
        "grievance.email",
        "legal.gstin",
        "legal.stateCode",
        "returns.windowDays",
      ] as const)
    : null;
  const [
    fabricTechEnabled,
    mixMatchEnabled,
    flatRate,
    freeAbove,
    phone,
    whatsapp,
    email,
    address,
    grievanceName,
    grievanceDesignation,
    grievancePhone,
    grievanceEmail,
    gstin,
    stateCode,
    returnsWindowDays,
  ] = storeOnlySettings ?? [false, false, 0, 0, "", "", "", "", "", "", "", "", "", "36", 30];

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
          {canStore && storeOnlyUpdatedAt ? (
            <>
              <SiteSettingToggle
                settingKey="pages.fabricTech.enabled"
                enabled={fabricTechEnabled}
                label="Fabric Technology page"
                updatedAt={storeOnlyUpdatedAt["pages.fabricTech.enabled"]}
              />
              <SiteSettingToggle
                settingKey="pages.mixMatch.enabled"
                enabled={mixMatchEnabled}
                label="Mix & Match page"
                updatedAt={storeOnlyUpdatedAt["pages.mixMatch.enabled"]}
              />
            </>
          ) : null}
          <SiteSettingToggle
            settingKey="sale.enabled"
            enabled={saleEnabled}
            label="Sale section"
            updatedAt={sharedUpdatedAt["sale.enabled"]}
          />
          <SiteSettingToggle
            settingKey="header.bulkCta.enabled"
            enabled={bulkCtaEnabled}
            label="Header Bulk Order CTA"
            updatedAt={sharedUpdatedAt["header.bulkCta.enabled"]}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Content</h2>
        <div className="grid gap-4">
          <AnnouncementEditor
            initialMessages={announcementMessages}
            updatedAt={sharedUpdatedAt["announcement.messages"]}
          />
          {canStore && storeOnlyUpdatedAt ? (
            <>
              <ContactEditor
                initial={{ phone, whatsapp, email, address }}
                updatedAt={{
                  phone: storeOnlyUpdatedAt["contact.phone"],
                  whatsapp: storeOnlyUpdatedAt["contact.whatsapp"],
                  email: storeOnlyUpdatedAt["contact.email"],
                  address: storeOnlyUpdatedAt["contact.address"],
                }}
              />
              <ShippingEditor
                initial={{ flatRate, freeAbove }}
                updatedAt={{
                  flatRate: storeOnlyUpdatedAt["shipping.flatRate"],
                  freeAbove: storeOnlyUpdatedAt["shipping.freeAbove"],
                }}
              />
              <LegalComplianceEditor
                initial={{
                  grievanceName,
                  grievanceDesignation,
                  grievancePhone,
                  grievanceEmail,
                  gstin,
                  stateCode,
                  returnsWindowDays,
                }}
                updatedAt={{
                  grievanceName: storeOnlyUpdatedAt["grievance.name"],
                  grievanceDesignation: storeOnlyUpdatedAt["grievance.designation"],
                  grievancePhone: storeOnlyUpdatedAt["grievance.phone"],
                  grievanceEmail: storeOnlyUpdatedAt["grievance.email"],
                  gstin: storeOnlyUpdatedAt["legal.gstin"],
                  stateCode: storeOnlyUpdatedAt["legal.stateCode"],
                  returnsWindowDays: storeOnlyUpdatedAt["returns.windowDays"],
                }}
              />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
