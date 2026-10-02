"use client";

import { useState } from "react";

/**
 * F-267: an actual end-to-end test send next to the Brevo credentials
 * (POST /api/admin/integrations/brevo/test). Shown whenever Brevo is
 * configured, whether the email toggle is on or off (see BrevoSetupActions):
 * "Test connection" only pings Brevo's account endpoint and sends nothing,
 * so this is the only check that a real message reaches an inbox from the
 * saved From Email. It works while the toggle is still off, so the owner can
 * prove delivery before releasing any queued email.
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
        setState({
          status: "ok",
          message:
            `Sent to ${body.sentTo ?? "your admin email"}.` +
            (body.enabled === false
              ? " Check your inbox — then turn email on to start sending real emails."
              : " Check your inbox (and spam folder)."),
        });
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
        className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.status === "sending" ? "Sending…" : "Send test email to me"}
      </button>
      {state.status === "ok" ? (
        <p role="status" className="text-xs text-trust">
          {state.message}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-red-600">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
