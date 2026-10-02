import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

/**
 * F-171: Next only reaches a `not-found.tsx` through `notFound()` — a URL
 * that matches no route at all (`/admin/foo`) skips every nested boundary
 * and renders the root, storefront-styled 404 instead (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * not-found.md). This catch-all matches any unknown path under /admin
 * *inside* the (panel) layout and throws `notFound()` itself, so the
 * request renders ./not-found.tsx within the admin shell. Every real
 * admin route is a more specific match and wins over it.
 *
 * It still checks the session first (like every other page here — see
 * admin-routes-guarded.test.ts) so an unauthenticated visitor is sent to
 * the login page rather than told which admin URLs exist.
 */
export default async function AdminUnknownPage() {
  await requireAdminPage("dashboard:view");
  notFound();
}
