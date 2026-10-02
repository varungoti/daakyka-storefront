"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTimeIST } from "@/lib/format/datetime";

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  /** F-168: where this notification's subject lives (its order, enquiry,
   * campaign...) — resolved server-side, already filtered to pages the
   * viewing role can open. See src/lib/admin/notification-links.ts. */
  link?: { href: string; label: string } | null;
}

export function NotificationList({
  notifications,
  unreadTotal,
  emptyMessage = "No notifications yet.",
}: {
  notifications: NotificationRow[];
  /** F-168: the real number of unread notifications across every page, not
   * just the ones in `notifications` — this component only ever receives
   * one page of the feed, so counting its own rows under-reported. */
  unreadTotal?: number;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const unreadCount = unreadTotal ?? notifications.filter((n) => !n.read).length;

  // F-168: both calls used to ignore a non-OK response (and a network
  // failure) entirely — the button just stopped spinning and nothing
  // changed, with no hint why.
  const markRead = async (id: string) => {
    setBusyId(id);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (response.ok) router.refresh();
      else setErrorMessage("Couldn't mark that notification as read — try again.");
    } catch {
      setErrorMessage("Couldn't mark that notification as read — check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/admin/notifications/mark-all-read", { method: "POST" });
      if (response.ok) router.refresh();
      else setErrorMessage("Couldn't mark the notifications as read — try again.");
    } catch {
      setErrorMessage("Couldn't mark the notifications as read — check your connection and try again.");
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={markAllRead}
          disabled={markingAll || unreadCount === 0}
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-ink hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {markingAll ? "Marking…" : `Mark all read (${unreadCount})`}
        </button>
      </div>
      {errorMessage ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
          {errorMessage}
        </p>
      ) : null}
      <ul className="space-y-3">
        {notifications.map((note) => (
          <li
            key={note.id}
            className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 ${note.read ? "border-border" : "border-brand/30 bg-brand/5"}`}
          >
            <div className="min-w-0">
              <p className="font-semibold text-ink">{note.title}</p>
              <p className="mt-1 break-words text-sm text-muted">{note.body}</p>
              {/* F-060: this is a client component, so it renders once
                  during SSR (server timezone) and again at hydration
                  (browser timezone) — `toLocaleString("en-IN")` with no
                  `timeZone` disagreed between the two whenever they
                  differ, throwing React hydration error #418. An
                  explicit timeZone makes both renders identical. */}
              <p className="mt-2 text-xs text-muted">{formatDateTimeIST(note.createdAt)}</p>
              {note.link ? (
                <Link href={note.link.href} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  {note.link.label} →
                </Link>
              ) : null}
            </div>
            {!note.read && (
              <button
                type="button"
                onClick={() => markRead(note.id)}
                disabled={busyId === note.id}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyId === note.id ? "…" : "Mark read"}
              </button>
            )}
          </li>
        ))}
        {notifications.length === 0 && <p className="text-sm text-muted">{emptyMessage}</p>}
      </ul>
    </div>
  );
}
