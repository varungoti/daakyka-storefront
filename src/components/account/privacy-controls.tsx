"use client";

import { Button, buttonClassNames } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/**
 * F-315: the controls the privacy policy promises, on the Profile tab —
 * change the account email (re-verified through a link sent to the new
 * address), see and change marketing-email consent, download everything we
 * hold, and delete the account. Each one calls its own /api/account route;
 * the destructive ones ask for the current password again.
 */

export type MarketingStatus = "subscribed" | "pending" | "unsubscribed" | "none";

interface Props {
  email: string;
  marketing: MarketingStatus;
  /** Set by the email-change confirmation link when it could not be applied. */
  emailChangeNotice?: "invalid";
}

const inputClass =
  "w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function PrivacyControls({ email, marketing, emailChangeNotice }: Props) {
  return (
    <section aria-labelledby="privacy-heading" className="max-w-md space-y-6">
      <div>
        <h3 id="privacy-heading" className="font-display text-lg font-bold text-ink">
          Your data and privacy
        </h3>
        <p className="mt-1 text-sm text-muted">Change your email, choose what we send you, or take your data with you.</p>
      </div>
      {emailChangeNotice === "invalid" && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          That email-change link is invalid or has expired. Please request the change again below.
        </p>
      )}
      <ChangeEmailForm currentEmail={email} />
      <MarketingToggle initial={marketing} />
      <DownloadData />
      <DeleteAccount />
    </section>
  );
}

function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const id = useId();
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: data.get("newEmail"), currentPassword: data.get("currentPassword") }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!response.ok) {
        setStatus("error");
        setMessage(body?.error ?? "Could not start the change. Please try again.");
        return;
      }
      setStatus("sent");
      setMessage(body?.message ?? "Check your new inbox for a confirmation link.");
      form.reset();
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border p-5">
      <h4 className="font-semibold text-ink">Change email address</h4>
      <p className="text-sm text-muted">
        Currently {currentEmail}. We&apos;ll send a confirmation link to the new address — nothing changes until you
        click it, and you&apos;ll be signed out everywhere afterwards.
      </p>
      <div>
        <label htmlFor={`${id}-new`} className="mb-1 block text-sm font-semibold text-ink">
          New email address
        </label>
        <input id={`${id}-new`} name="newEmail" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <div>
        <label htmlFor={`${id}-pw`} className="mb-1 block text-sm font-semibold text-ink">
          Current password
        </label>
        <input
          id={`${id}-pw`}
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      {status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      {status === "sent" && (
        <p role="status" className="text-sm text-trust-ink">
          {message}
        </p>
      )}
      <Button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Sending…" : "Send confirmation link"}
      </Button>
    </form>
  );
}

const MARKETING_COPY: Record<MarketingStatus, string> = {
  subscribed: "You're subscribed to our marketing emails.",
  pending: "We've sent you a confirmation link — marketing emails start once you click it.",
  unsubscribed: "You're not receiving marketing emails.",
  none: "You're not subscribed to our marketing emails.",
};

function MarketingToggle({ initial }: { initial: MarketingStatus }) {
  const [status, setStatus] = useState<MarketingStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const wantsMarketing = status === "subscribed" || status === "pending";

  async function change(subscribed: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/marketing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed }),
      });
      const body = (await response.json().catch(() => null)) as { status?: MarketingStatus; error?: string } | null;
      if (!response.ok || !body?.status) {
        setError(body?.error ?? "Could not update your preference. Please try again.");
        return;
      }
      setStatus(body.status);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-5">
      <h4 className="font-semibold text-ink">Marketing emails</h4>
      <p className="text-sm text-muted" role="status">
        {MARKETING_COPY[status]} Order and account emails are always sent.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button variant="outline" disabled={busy} onClick={() => change(!wantsMarketing)}>
        {busy ? "Saving…" : wantsMarketing ? "Unsubscribe" : "Subscribe"}
      </Button>
    </div>
  );
}

function DownloadData() {
  return (
    <div className="space-y-3 rounded-2xl border border-border p-5">
      <h4 className="font-semibold text-ink">Download your data</h4>
      <p className="text-sm text-muted">
        A copy of everything we hold about you — profile, addresses, orders, reviews, preferences and the emails we
        sent — as a JSON file.
      </p>
      <a href="/api/account/export" download className={buttonClassNames({ variant: "outline" })}>
        Download my data
      </a>
    </div>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.get("password"), confirm: data.get("confirm") }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not delete your account. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-red-200 p-5">
      <h4 className="font-semibold text-ink">Delete my account</h4>
      <p className="text-sm text-muted">
        Permanently deletes your account, saved addresses, wishlist, reviews and marketing preferences. Orders you have
        placed are kept for our tax records but no longer carry your name, email, phone or street address. This cannot
        be undone.
      </p>
      {!open ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor={`${id}-pw`} className="mb-1 block text-sm font-semibold text-ink">
              Your password
            </label>
            <input
              id={`${id}-pw`}
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-confirm`} className="mb-1 block text-sm font-semibold text-ink">
              Type DELETE to confirm
            </label>
            <input
              id={`${id}-confirm`}
              name="confirm"
              required
              pattern="DELETE"
              autoComplete="off"
              className={inputClass}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Permanently delete my account"}
            </button>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
