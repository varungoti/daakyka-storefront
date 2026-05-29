"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ContactForm({
  defaultType = "GENERAL",
}: {
  defaultType?: "GENERAL" | "BULK_ORDER" | "INSTITUTIONAL" | "SUPPORT";
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("loading");

    const form = new FormData(event.currentTarget);
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
      }),
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    setStatus("success");
    event.currentTarget.reset();
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
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-white p-8">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Full Name *" name="name" required />
        <Field label="Email *" name="email" type="email" required />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Phone / WhatsApp" name="phone" type="tel" />
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
          rows={5}
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          placeholder="Tell us about your uniform or linen requirements..."
        />
      </div>
      {status === "error" && (
        <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
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
        className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </div>
  );
}
