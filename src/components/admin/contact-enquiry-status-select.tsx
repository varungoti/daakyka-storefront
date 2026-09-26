"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ContactEnquiryAdminStatus = "NEW" | "CONTACTED" | "CLOSED";

const statusOptions: ContactEnquiryAdminStatus[] = ["NEW", "CONTACTED", "CLOSED"];

/**
 * F-049: /admin/contact-enquiries had no way to record that an enquiry
 * had been handled, so every row stayed "NEW" forever. Mirrors
 * src/components/admin/bulk-lead-status-select.tsx's optimistic-update
 * pattern, against the new PATCH /api/admin/contact-enquiries/[id].
 */
export function ContactEnquiryStatusSelect({
  enquiryId,
  currentStatus,
}: {
  enquiryId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(currentStatus);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const updateStatus = async (status: ContactEnquiryAdminStatus) => {
    const previous = value;
    setValue(status);
    setPending(true);
    setFailed(false);

    try {
      const response = await fetch(`/api/admin/contact-enquiries/${enquiryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        setValue(previous);
        setFailed(true);
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  // A status the API doesn't know about (there is none today, but the
  // column is a free String) still needs to render as a selectable option
  // rather than silently coercing to the first one in the list.
  const options = statusOptions.includes(value as ContactEnquiryAdminStatus)
    ? statusOptions
    : [value, ...statusOptions];

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => updateStatus(e.target.value as ContactEnquiryAdminStatus)}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase outline-none focus:border-brand disabled:opacity-60"
      >
        {options.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {failed && <span className="text-[11px] font-normal normal-case text-red-600">Couldn&apos;t update. Try again.</span>}
    </div>
  );
}
