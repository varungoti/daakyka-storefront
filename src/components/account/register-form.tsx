"use client";

import { Button } from "@/components/ui/button";
import { HoneypotField } from "@/components/ui/honeypot-field";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { INDIAN_PHONE_HINT, normalizeIndianPhone } from "@/lib/validation/india";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** F-132: the field names customerRegisterSchema (src/lib/validation/
 * schemas.ts) can report a `details.fieldErrors` entry for. */
type RegisterFieldErrors = Partial<Record<"name" | "email" | "password" | "phone" | "consentGiven", string>>;

export function RegisterForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  // F-042: an existing account gets its own message with real sign-in/
  // reset-password links, rather than the generic dead-end error text.
  const [emailTaken, setEmailTaken] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Captured before the await — see contact-form.tsx for why.
    const formElement = event.currentTarget;
    setStatus("loading");
    setError("");
    setFieldErrors({});
    setEmailTaken(false);

    const form = new FormData(formElement);
    const rawPhone = ((form.get("phone") as string) || "").trim();

    // F-132: client-side format check first, same rule as the server
    // (customerRegisterSchema) which re-checks regardless — this just
    // gives an immediate, specific message instead of a round trip. Phone
    // is optional here, so an empty value is never flagged.
    const normalizedPhone = rawPhone ? normalizeIndianPhone(rawPhone) : null;
    if (rawPhone && !normalizedPhone) {
      setStatus("error");
      setFieldErrors({ phone: INDIAN_PHONE_HINT });
      setError("Please fix the highlighted field(s) below.");
      return;
    }

    try {
      const response = await fetch("/api/account/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          phone: normalizedPhone ?? undefined,
          consentGiven: form.get("consentGiven") === "on",
          [HONEYPOT_FIELD_NAME]: form.get(HONEYPOT_FIELD_NAME) || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setStatus("error");
        if (data?.code === "EMAIL_TAKEN") {
          setEmailTaken(true);
          setError(data.error);
          return;
        }
        // F-132: surface the real per-field message (e.g. a bad phone
        // number) instead of only ever showing "Validation failed".
        const details = data?.details?.fieldErrors as Record<string, string[]> | undefined;
        if (details) {
          const flattened: RegisterFieldErrors = {};
          for (const [key, messages] of Object.entries(details)) {
            if (messages?.[0]) flattened[key as keyof RegisterFieldErrors] = messages[0];
          }
          setFieldErrors(flattened);
          setError("Please fix the highlighted field(s) below.");
          return;
        }
        setError(data?.error ?? "Could not create your account. Please try again.");
        return;
      }

      router.push(returnTo);
      router.refresh();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-surface-elevated p-8">
      <HoneypotField />
      <Field
        label="Full Name *"
        name="name"
        required
        minLength={2}
        autoComplete="name"
        error={fieldErrors.name}
      />
      <Field
        label="Email *"
        name="email"
        type="email"
        required
        autoComplete="email"
        error={fieldErrors.email}
      />
      <Field
        label="Phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        hint={INDIAN_PHONE_HINT}
        error={fieldErrors.phone}
      />
      <Field
        label="Password *"
        name="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        hint="At least 8 characters."
        error={fieldErrors.password}
      />
      <label className="flex items-start gap-3 text-sm text-muted">
        <input type="checkbox" name="consentGiven" required className="mt-1 h-4 w-4 rounded border-border text-brand" />
        I agree to the terms of service and privacy policy.
      </label>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
          {emailTaken && (
            <>
              {" "}
              <Link
                href={`/account/login?returnTo=${encodeURIComponent(returnTo)}`}
                className="font-semibold underline"
              >
                Sign in
              </Link>{" "}
              or{" "}
              <Link href="/account/forgot-password" className="font-semibold underline">
                reset your password
              </Link>
              .
            </>
          )}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={status === "loading"}>
        {status === "loading" ? "Creating account..." : "Create Account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href={`/account/login?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  minLength,
  hint,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  hint?: string;
  error?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
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
        autoComplete={autoComplete}
        minLength={minLength}
        aria-invalid={Boolean(error)}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/20 ${
          error ? "border-red-400 focus:border-red-500" : "border-border focus:border-brand"
        }`}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
