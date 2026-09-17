"use client";

import { Button } from "@/components/ui/button";
import { HoneypotField } from "@/components/ui/honeypot-field";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { useState } from "react";

export function BulkOrderForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Captured before the await — see contact-form.tsx for why.
    const formElement = event.currentTarget;
    setStatus("loading");
    setError("");

    const form = new FormData(formElement);
    const payload = {
      organization: form.get("organization"),
      contactPerson: form.get("contactPerson"),
      email: form.get("email"),
      phone: form.get("phone"),
      city: form.get("city") || undefined,
      staffCount: form.get("staffCount") ? Number(form.get("staffCount")) : undefined,
      productsRequired: form.get("productsRequired") || undefined,
      colorsRequired: form.get("colorsRequired") || undefined,
      sizesRequired: form.get("sizesRequired") || undefined,
      logoEmbroidery: form.get("logoEmbroidery") === "on",
      deliveryTimeline: form.get("deliveryTimeline") || undefined,
      notes: form.get("notes") || undefined,
      consentGiven: form.get("consentGiven") === "on",
      [HONEYPOT_FIELD_NAME]: form.get(HONEYPOT_FIELD_NAME) || undefined,
    };

    try {
      const response = await fetch("/api/bulk-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setStatus("error");
        setError("Please check all required fields and try again.");
        return;
      }

      setStatus("success");
      formElement.reset();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  if (status === "success") {
    return (
      <div className="rounded-3xl border border-trust/30 bg-trust/10 p-8 text-center">
        <h2 className="font-display text-2xl font-bold text-ink">Enquiry Received</h2>
        <p className="mt-3 text-muted">
          Our bulk orders team will contact you within 1–2 business days.
        </p>
        <Button className="mt-6" onClick={() => setStatus("idle")}>
          Submit Another Enquiry
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-surface p-8">
      <HoneypotField />
      <FormField label="Hospital / Clinic Name *" name="organization" required />
      <FormField label="Contact Person *" name="contactPerson" required />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Email *" name="email" type="email" required />
        <FormField label="Phone / WhatsApp *" name="phone" type="tel" required />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="City" name="city" />
        <FormField label="Number of Staff" name="staffCount" type="number" />
      </div>
      <FormField label="Products Required" name="productsRequired" placeholder="Tops, joggers, sets..." />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Colors Required" name="colorsRequired" />
        <FormField label="Sizes Required" name="sizesRequired" />
      </div>
      <FormField label="Delivery Timeline" name="deliveryTimeline" placeholder="e.g. Within 4 weeks" />
      <label className="flex items-center gap-3 text-sm text-ink">
        <input type="checkbox" name="logoEmbroidery" className="h-4 w-4 rounded border-border text-brand" />
        Logo embroidery required
      </label>
      <div>
        <label htmlFor="notes" className="mb-2 block text-sm font-semibold text-ink">
          Additional Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          placeholder="Department breakdown, branding guidelines, special requirements..."
        />
      </div>
      <label className="flex items-start gap-3 text-sm text-muted">
        <input
          type="checkbox"
          name="consentGiven"
          required
          className="mt-1 h-4 w-4 rounded border-border text-brand"
        />
        I agree to be contacted by DAAKYKA regarding this bulk order enquiry.
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={status === "loading"}>
        {status === "loading" ? "Submitting..." : "Submit Enquiry"}
      </Button>
    </form>
  );
}

function FormField({
  label,
  name,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        placeholder={placeholder}
        className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </div>
  );
}
