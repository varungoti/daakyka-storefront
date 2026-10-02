"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * F-267: the "Turn on email" action inside the Integrations page's
 * "key saved, but email sending is OFF" callout. The same PATCH the
 * Enabled/Disabled pill above sends — surfaced where the owner is actually
 * looking, with a confirm that says how many emails are waiting, because
 * switching Brevo on makes the outbox drain send every queued email at
 * once (including any stale order emails).
 */
export function BrevoEnableButton({ waitingEmails }: { waitingEmails: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const turnOn = async () => {
    if (
      waitingEmails > 0 &&
      !window.confirm(
        `${waitingEmails} queued email${waitingEmails === 1 ? "" : "s"} will be sent as soon as email is turned on. Turn it on now?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/integrations/brevo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={turnOn}
        className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Turning on…" : "Turn on email"}
      </button>
      {failed ? <p className="text-xs text-red-600">Couldn&apos;t turn email on. Try again.</p> : null}
    </div>
  );
}
