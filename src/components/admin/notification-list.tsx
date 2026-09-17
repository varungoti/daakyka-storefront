"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch(`/api/admin/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (response.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const response = await fetch("/api/admin/notifications/mark-all-read", { method: "POST" });
      if (response.ok) router.refresh();
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
      <ul className="space-y-3">
        {notifications.map((note) => (
          <li
            key={note.id}
            className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 ${note.read ? "border-border" : "border-brand/30 bg-brand/5"}`}
          >
            <div className="min-w-0">
              <p className="font-semibold text-ink">{note.title}</p>
              <p className="mt-1 text-sm text-muted">{note.body}</p>
              <p className="mt-2 text-xs text-muted">{new Date(note.createdAt).toLocaleString("en-IN")}</p>
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
        {notifications.length === 0 && <p className="text-sm text-muted">No notifications yet.</p>}
      </ul>
    </div>
  );
}
