"use client";

import { Button } from "@/components/ui/button";
import { HoneypotField } from "@/components/ui/honeypot-field";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { useState } from "react";

export function NewsletterSignup({ source = "footer" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!consentGiven) {
      setStatus("error");
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
        return;
      }

      setStatus("success");
      setEmail("");
      setConsentGiven(false);
    } catch {
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className="rounded-2xl bg-trust/10 px-5 py-4 text-sm font-medium text-trust">
        Almost there! Check your inbox to confirm your subscription.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <HoneypotField />
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
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
          className="mt-0.5"
        />
        <span>
          I agree to receive marketing emails from DAAKYKA Apparels. You can unsubscribe at any
          time.
        </span>
      </label>
      {status === "error" && (
        <p className="text-sm text-red-600">
          {consentGiven ? "Please enter a valid email." : "Please agree to receive emails to subscribe."}
        </p>
      )}
    </form>
  );
}
