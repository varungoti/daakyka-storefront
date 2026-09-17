"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function UnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    token ? "idle" : "error",
  );

  const handleUnsubscribe = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setStatus(response.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (!token) {
    return <p className="text-sm text-muted">This unsubscribe link is missing its token.</p>;
  }

  if (status === "done") {
    return (
      <p className="text-sm text-muted">
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
        <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
      )}
    </div>
  );
}
