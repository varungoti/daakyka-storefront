"use client";

import { Button } from "@/components/ui/button";
import { HoneypotField } from "@/components/ui/honeypot-field";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { useState } from "react";

export function ContactForm({
  defaultType = "GENERAL",
}: {
  defaultType?: "GENERAL" | "BULK_ORDER" | "INSTITUTIONAL" | "SUPPORT";
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Captured before the await: currentTarget is only valid while the
    // event is actively being handled, and reading it again after an
    // await can return null.
    const formElement = event.currentTarget;
    setStatus("loading");
    setErrorMessage("");
    setFieldErrors({});

    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          phone: form.get("phone") || undefined,
          organization: form.get("organization") || undefined,
          type: form.get("type") || defaultType,
          message: form.get("message"),
          [HONEYPOT_FIELD_NAME]: form.get(HONEYPOT_FIELD_NAME) || undefined,
        }),
      });

      if (!response.ok) {
        setStatus("error");
        // F-152: a short message or name used to show only "Something went
        // wrong" — indistinguishable from a real server fault. Surface the
        // real per-field message the API now returns instead.
        const data = await response.json().catch(() => null);
        const details = data?.details?.fieldErrors as Record<string, string[]> | undefined;
        if (details) {
          const flattened: Record<string, string> = {};
          for (const [key, messages] of Object.entries(details)) {
            if (messages?.[0]) flattened[key] = messages[0];
          }
          setFieldErrors(flattened);
          setErrorMessage("Please fix the highlighted field(s) below.");
        } else if (response.status === 429) {
          setErrorMessage("Too many attempts, please wait a minute and try again.");
        } else {
          setErrorMessage("Something went wrong. Please try again.");
        }
        return;
      }

      setStatus("success");
      formElement.reset();
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  };

  if (status === "success") {
    return (
      <div className="rounded-3xl border border-trust/30 bg-trust/10 p-8 text-center">
        <h2 className="font-display text-xl font-bold text-ink">Message Sent</h2>
        <p className="mt-2 text-sm text-muted">
          Our team at Babaji Enterprises will respond within 1–2 business days.
        </p>
        <Button className="mt-4" onClick={() => setStatus("idle")}>
          Send Another Message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-surface-elevated p-8">
      <HoneypotField />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Full Name *" name="name" required minLength={2} maxLength={120} error={fieldErrors.name} />
        <Field label="Email *" name="email" type="email" required error={fieldErrors.email} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Phone / WhatsApp" name="phone" type="tel" maxLength={32} />
        <Field label="Organization" name="organization" />
      </div>
      <div>
        <label htmlFor="type" className="mb-2 block text-sm font-semibold text-ink">
          Enquiry Type
        </label>
        <select
          id="type"
          name="type"
          defaultValue={defaultType}
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
        >
          <option value="GENERAL">General Enquiry</option>
          <option value="INSTITUTIONAL">Institutional Uniforms</option>
          <option value="BULK_ORDER">Bulk / Hospital Order</option>
          <option value="SUPPORT">Product Support</option>
        </select>
      </div>
      <div>
        <label htmlFor="message" className="mb-2 block text-sm font-semibold text-ink">
          Message *
        </label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          aria-invalid={Boolean(fieldErrors.message)}
          aria-describedby={fieldErrors.message ? "message-error" : undefined}
          className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/20 ${
            fieldErrors.message ? "border-red-400 focus:border-red-500" : "border-border focus:border-brand"
          }`}
          placeholder="Tell us about your uniform or linen requirements..."
        />
        {fieldErrors.message && (
          <p id="message-error" className="mt-1 text-xs text-red-600">
            {fieldErrors.message}
          </p>
        )}
      </div>
      {status === "error" && (
        <p className="text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={status === "loading"}>
        {status === "loading" ? "Sending..." : "Send Enquiry"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  minLength,
  maxLength,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  error?: string;
}) {
  const errorId = error ? `${name}-error` : undefined;
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/20 ${
          error ? "border-red-400 focus:border-red-500" : "border-border focus:border-brand"
        }`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
