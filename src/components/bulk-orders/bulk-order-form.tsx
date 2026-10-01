"use client";

import { Button } from "@/components/ui/button";
import { FocusedStatus } from "@/components/ui/focused-status";
import { HoneypotField } from "@/components/ui/honeypot-field";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { retryAfterMessage } from "@/lib/security/retry-after";
import { useEffect, useRef, useState } from "react";

const ORGANIZATION_TYPES = [
  { value: "HOSPITAL", label: "Hospital" },
  { value: "SCHOOL", label: "School" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "OTHER", label: "Other" },
] as const;

const CATEGORY_INTEREST_OPTIONS = [
  "Scrubs & Hospital Wear",
  "Hospital Linens",
  "School Uniforms",
  "Sports Uniforms",
  "Corporate Wear",
  "Kids Wear",
];

export function BulkOrderForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  // F-241: set by "Submit Another Enquiry" so the re-rendered form takes
  // focus — the button that was clicked is unmounted with the success box.
  const refocusForm = useRef(false);

  useEffect(() => {
    if (status !== "idle" || !refocusForm.current) return;
    refocusForm.current = false;
    (formRef.current?.elements.namedItem("organization") as HTMLElement | null)?.focus();
  }, [status]);

  // F-241: after a failed submit, move focus to the first field the server
  // (or the client-side check) marked invalid — same as checkout does.
  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Captured before the await — see contact-form.tsx for why.
    const formElement = event.currentTarget;
    setStatus("loading");
    setError("");
    setFieldErrors({});

    const form = new FormData(formElement);
    const categoryInterest = form.getAll("categoryInterest").map(String);
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
      organizationType: form.get("organizationType") || undefined,
      categoryInterest: categoryInterest.length > 0 ? categoryInterest : undefined,
      consentGiven: form.get("consentGiven") === "on",
      marketingOptIn: form.get("marketingOptIn") === "on",
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
        // F-152: the form used to show this same fixed sentence for every
        // failure, with no field marked, even though the API already
        // returns per-field messages (bulkOrderSchema's fieldErrors).
        const data = await response.json().catch(() => null);
        const details = data?.details?.fieldErrors as Record<string, string[]> | undefined;
        if (details) {
          const flattened: Record<string, string> = {};
          for (const [key, messages] of Object.entries(details)) {
            if (messages?.[0]) flattened[key] = messages[0];
          }
          setFieldErrors(flattened);
          setError("Please fix the highlighted field(s) below.");
        } else if (response.status === 429) {
          // F-323: read Retry-After instead of a fixed "wait a minute" —
          // mirrors src/components/contact/contact-form.tsx.
          setError(retryAfterMessage(response, "enquiries"));
        } else {
          setError("Please check all required fields and try again.");
        }
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
      <FocusedStatus className="rounded-3xl border border-trust/30 bg-trust/10 p-8 text-center">
        <h2 className="font-display text-2xl font-bold text-ink">Enquiry Received</h2>
        <p className="mt-3 text-muted">
          Our bulk orders team will contact you within 1–2 business days.
        </p>
        <Button
          className="mt-6"
          onClick={() => {
            refocusForm.current = true;
            setStatus("idle");
          }}
        >
          Submit Another Enquiry
        </Button>
      </FocusedStatus>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-surface p-8">
      <HoneypotField />
      <FormField
        label="Organisation / Institution Name *"
        name="organization"
        required
        minLength={2}
        maxLength={200}
        error={fieldErrors.organization}
      />
      <FormField
        label="Contact Person *"
        name="contactPerson"
        required
        minLength={2}
        maxLength={120}
        error={fieldErrors.contactPerson}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Email *" name="email" type="email" required error={fieldErrors.email} />
        <FormField
          label="Phone / WhatsApp *"
          name="phone"
          type="tel"
          required
          minLength={8}
          maxLength={32}
          inputMode="tel"
          error={fieldErrors.phone}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="City" name="city" />
        <FormField label="Team Size / Headcount" name="staffCount" type="number" min={1} step={1} error={fieldErrors.staffCount} />
      </div>
      <div>
        <label htmlFor="organizationType" className="mb-2 block text-sm font-semibold text-ink">
          Organisation Type
        </label>
        <select
          id="organizationType"
          name="organizationType"
          defaultValue=""
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
        >
          <option value="">Select organisation type</option>
          {ORGANIZATION_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className="mb-2 block text-sm font-semibold text-ink">Categories of Interest</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORY_INTEREST_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                name="categoryInterest"
                value={option}
                className="h-4 w-4 rounded border-border text-brand"
              />
              {option}
            </label>
          ))}
        </div>
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
          maxLength={2000}
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
      {/* F-071: separate, unticked opt-in — the checkbox above only covers
          this enquiry, not general marketing. */}
      <label className="flex items-start gap-3 text-sm text-muted">
        <input
          type="checkbox"
          name="marketingOptIn"
          className="mt-1 h-4 w-4 rounded border-border text-brand"
        />
        Also send me offers, new arrivals and updates from DAAKYKA by email.
      </label>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
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
  minLength,
  maxLength,
  min,
  step,
  inputMode,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  step?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
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
        placeholder={placeholder}
        minLength={minLength}
        maxLength={maxLength}
        min={min}
        step={step}
        inputMode={inputMode}
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
