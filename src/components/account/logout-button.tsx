"use client";

import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * F-144: "Sign out" used to exist only at the very bottom of the Profile tab,
 * below the password form and the privacy controls — on a phone, signing out
 * of /account/orders meant finding Profile and scrolling past all of it. It is
 * now the last item of AccountNav, so it is on every account page.
 *
 * It only reports success once the server has cleared the session cookie: if
 * the request fails the shopper stays where they are with a message instead of
 * being sent to the home page still signed in, which on a shared device looks
 * exactly like having signed out.
 */
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const handleLogout = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/account/logout", { method: "POST" });
      if (!response.ok) {
        setStatus("error");
        return;
      }
    } catch {
      setStatus("error");
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleLogout}
        disabled={status === "loading"}
        className={cn(
          "rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted transition hover:border-ink hover:text-ink disabled:opacity-60",
          className,
        )}
      >
        {status === "loading" ? "Signing out…" : "Sign Out"}
      </button>
      {status === "error" && (
        <p role="alert" className="basis-full text-sm text-red-600">
          Could not sign you out. Please try again.
        </p>
      )}
    </>
  );
}
