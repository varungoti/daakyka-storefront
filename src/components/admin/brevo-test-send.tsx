"use client";

import { useState } from "react";

/**
 * F-267 (remaining UI gap flagged by admin-engagement-campaigns-ux, which
 * built POST /api/admin/integrations/brevo/test but couldn't wire it up
 * itself — that route lives outside this package's owned files): surfaces
 * an actual end-to-end test send next to the Brevo credentials, for the
 * case the auto-enable-on-save logic doesn't cover — a key configured via
 * env var, or only one of the two Brevo fields saved so far — where the
 * provider can show "configured" while still not actually sending mail.
 */
export function BrevoTestSend() {
  const [state, setState] = useState<{ status: "idle" | "sending" | "ok" | "error"; message?: string }>({
    status: "idle",
  });

  const sendTest = async () => {
    setState({ status: "sending" });
    try {
      const response = await fetch("/api/admin/integrations/brevo/test", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) {
        setState({ status: "ok", message: `Sent to ${body.sentTo ?? "your admin email"}.` });
      } else {
        setState({ status: "error", message: body.error ?? "Couldn't send the test email." });
      }
    } catch {
      setState({ status: "error", message: "Couldn't reach the server." });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={state.status === "sending"}
        onClick={sendTest}
        className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.status === "sending" ? "Sending…" : "Send test email to me"}
      </button>
      {state.status === "ok" ? <p className="text-xs text-trust">{state.message}</p> : null}
      {state.status === "error" ? <p className="text-xs text-red-600">{state.message}</p> : null}
    </div>
  );
}
