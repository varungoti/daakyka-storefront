"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function NewsletterSignup({ source = "footer" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("loading");

    const response = await fetch("/api/newsletter/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source, consentGiven: true }),
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    setStatus("success");
    setEmail("");
  };

  if (status === "success") {
    return (
      <div className="rounded-2xl bg-trust/10 px-5 py-4 text-sm font-medium text-trust">
        You&apos;re subscribed! Check your inbox for your welcome offer.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
        required
        className="min-w-[260px] rounded-full border border-border bg-white px-5 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <Button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Subscribing..." : "Subscribe"}
      </Button>
      {status === "error" && (
        <p className="text-sm text-red-600 sm:absolute sm:mt-14">Please enter a valid email.</p>
      )}
    </form>
  );
}
