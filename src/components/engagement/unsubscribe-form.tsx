"use client";

import { Button } from "@/components/ui/button";
import { classifyUnsubscribeResponse } from "@/lib/engagement/unsubscribe-response";
import { retryAfterMessage } from "@/lib/security/retry-after";
import Link from "next/link";
import { useState } from "react";

type UnsubscribeStatus = "idle" | "loading" | "done" | "invalid-link" | "error";

/** `contactEmail` is the store's admin-editable contact address (empty when
 * unset), so an invalid link can point the shopper at a person instead of a
 * dead end. */
export function UnsubscribeForm({ token, contactEmail = "" }: { token: string; contactEmail?: string }) {
  const [status, setStatus] = useState<UnsubscribeStatus>(token ? "idle" : "invalid-link");
  const [errorMessage, setErrorMessage] = useState("");

  const handleUnsubscribe = async () => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const response = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const outcome = classifyUnsubscribeResponse(response.status);
      if (outcome === "rate-limited") {
        setErrorMessage(retryAfterMessage(response, "attempts"));
      } else if (outcome === "error") {
        setErrorMessage("Something went wrong. Please try again.");
      }
      setStatus(outcome === "done" ? "done" : outcome === "invalid-link" ? "invalid-link" : "error");
    } catch {
      setErrorMessage("Something went wrong. Please check your connection and try again.");
      setStatus("error");
    }
  };

  if (status === "invalid-link") {
    return (
      <p role="alert" className="mx-auto max-w-md text-sm text-muted">
        This unsubscribe link is invalid or has expired.{" "}
        {contactEmail ? (
          <>
            Email{" "}
            <a href={`mailto:${contactEmail}`} className="font-semibold text-brand hover:underline">
              {contactEmail}
            </a>{" "}
            and we&apos;ll remove you.
          </>
        ) : (
          <>
            <Link href="/contact" className="font-semibold text-brand hover:underline">
              Contact us
            </Link>{" "}
            and we&apos;ll remove you.
          </>
        )}
      </p>
    );
  }

  if (status === "done") {
    return (
      <p role="status" className="text-sm text-muted">
        You&apos;ve been unsubscribed. You won&apos;t receive further marketing emails from us.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted">
        Click below to unsubscribe from DAAKYKA Apparels marketing emails.
      </p>
      <Button onClick={handleUnsubscribe} disabled={status === "loading"} size="lg">
        {status === "loading" ? "Unsubscribing..." : "Unsubscribe"}
      </Button>
      {status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
