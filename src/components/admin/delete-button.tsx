"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminRequest } from "@/lib/admin/request";

/** Generic "delete with confirm" button shared by the admin CRUD screens
 * added to close out the read-only-admin audit gaps (testimonials,
 * segments, templates, offers, SEO records). Confirms via the browser's
 * native confirm() — these are low-volume admin actions, not worth a
 * custom modal — and surfaces the server's error message (e.g. a
 * delete-blocked-by-reference 409) via alert() rather than failing silently.
 */
export function DeleteButton({
  href,
  confirmMessage,
  className,
  label = "Delete",
}: {
  href: string;
  confirmMessage: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (!window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      await adminRequest(href, "Couldn't delete the record.", { method: "DELETE" });
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't delete the record.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        className ??
        "rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {busy ? "Deleting…" : label}
    </button>
  );
}
