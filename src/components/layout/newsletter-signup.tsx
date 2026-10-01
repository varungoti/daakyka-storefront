"use client";

import { Button } from "@/components/ui/button";
import { FocusedStatus } from "@/components/ui/focused-status";
import { HoneypotField } from "@/components/ui/honeypot-field";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { retryAfterMessage } from "@/lib/security/retry-after";
import { useId, useState } from "react";

export function NewsletterSignup({ source = "footer" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  // F-323: this used to be inferred from the consent checkbox ("consent
  // ticked but still an error? must be the email") instead of read from
  // the response — which meant a 429 (rate limited) showed "Please enter
  // a valid email" even for a perfectly valid, already-confirmed address.
  const [errorMessage, setErrorMessage] = useState("");
  // Not a fixed id: the form can render more than once per page.
  const errorId = useId();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    if (!consentGiven) {
      setStatus("error");
      setErrorMessage("Please agree to receive emails to subscribe.");
      return;
    }
    const formElement = event.currentTarget;
    setStatus("loading");

    try {
      const honeypot = new FormData(formElement).get(HONEYPOT_FIELD_NAME);
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source,
          consentGiven,
          [HONEYPOT_FIELD_NAME]: honeypot || undefined,
        }),
      });

      if (!response.ok) {
        setStatus("error");
        if (response.status === 429) {
          // Keep the entered email/consent — this isn't a validation
          // problem, so there's nothing to fix before retrying.
          setErrorMessage(retryAfterMessage(response, "subscribe attempts"));
        } else {
          const data = await response.json().catch(() => null);
          setErrorMessage(data?.error ?? "Please enter a valid email.");
        }
        return;
      }

      setStatus("success");
      setEmail("");
      setConsentGiven(false);
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  };

  if (status === "success") {
    // F-241: announced + focused; text-trust-ink (not text-trust, ~2.9:1 on
    // this tint) for AA contrast.
    return (
      <FocusedStatus className="rounded-2xl bg-trust/10 px-5 py-4 text-sm font-medium text-trust-ink">
        Almost there! Check your inbox to confirm your subscription.
      </FocusedStatus>
    );
  }

  // The only client-side error raised before a request is sent is the
  // missing consent tick (every other failure comes back with consent already
  // given), so "error and no consent" is exactly "the consent error".
  const consentInvalid = status === "error" && !consentGiven;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <HoneypotField />
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          aria-label="Email address"
          autoComplete="email"
          required
          className="min-w-[260px] rounded-full border border-border bg-surface-input px-5 py-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Subscribing..." : "Subscribe"}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => setConsentGiven(e.target.checked)}
          aria-invalid={consentInvalid}
          aria-describedby={consentInvalid ? errorId : undefined}
          className="mt-0.5"
        />
        <span>
          I agree to receive marketing emails from DAAKYKA Apparels. You can unsubscribe at any
          time.
        </span>
      </label>
      {status === "error" && (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
