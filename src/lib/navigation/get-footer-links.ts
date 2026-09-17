import { isPageEnabled, isSaleEnabled } from "@/lib/settings";
import { buildFooterLinks } from "@/lib/navigation/build-footer-links";
import type { FooterColumn, FooterFlags, FooterLink, FooterLinks } from "@/lib/navigation/build-footer-links";

/**
 * Phase C6: the async, DB-reading half of the footer link builder. The
 * pure buildFooterLinks() itself now lives in build-footer-links.ts,
 * deliberately separate from this file — see that file's header comment
 * for why (importing @/lib/settings here pulls in @/lib/db -> `pg`, which
 * must never end up in the client bundle that renders <Footer>).
 *
 * Fabric Tech and Mix & Match only ever appear here (never in the main
 * nav), gated by isPageEnabled() exactly like the rest of the site.
 */
export type { FooterColumn, FooterFlags, FooterLink, FooterLinks };
export { buildFooterLinks };

export async function getFooterLinks(): Promise<FooterLinks> {
  const [fabricTechEnabled, mixMatchEnabled, saleEnabled] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    isSaleEnabled(),
  ]);
  return buildFooterLinks({ fabricTechEnabled, mixMatchEnabled, saleEnabled });
}
