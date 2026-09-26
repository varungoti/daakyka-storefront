"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * F-200 fix: the order detail page's "← Back to Orders" link used to
 * always point at the bare `/admin/orders`, throwing away whatever
 * search/filter/page the admin had on the list — OrdersTable now restores
 * those from the URL (see its own doc comment), so this only has to send
 * the admin back to the *same* URL they came from, when that's actually
 * where they came from.
 *
 * A plain `<Link href={document.referrer}>` would be unsafe (it could
 * point off-site, or the admin could have opened this order directly with
 * no referrer at all) — checked against `location.origin` and the
 * `/admin/orders` path first, and falls back to the bare list URL exactly
 * like before otherwise.
 */
export function BackToOrdersLink() {
  const [href, setHref] = useState("/admin/orders");

  useEffect(() => {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      if (referrer && referrer.origin === window.location.origin && referrer.pathname === "/admin/orders") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHref(`${referrer.pathname}${referrer.search}`);
      }
    } catch {
      // Malformed/absent referrer — keep the plain-list fallback.
    }
  }, []);

  return (
    <Link href={href} className="text-xs font-semibold text-brand hover:underline">
      ← Back to Orders
    </Link>
  );
}
