"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

export function PaymentStatusRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timers = [10_000, 25_000, 45_000].map((delay) =>
      setTimeout(() => router.refresh(), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [router]);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="mt-2 font-semibold text-brand underline disabled:opacity-60"
    >
      {pending ? "Checking…" : "Check payment status"}
    </button>
  );
}
