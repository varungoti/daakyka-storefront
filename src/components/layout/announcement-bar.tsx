"use client";

import { announcementItems } from "@/data/navigation";

export function AnnouncementBar() {
  return (
    <div className="bg-gradient-to-r from-brand to-brand-violet py-2.5 text-center text-xs font-medium tracking-wide text-white md:text-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4">
        {announcementItems.map((item, index) => (
          <span key={item} className="flex items-center gap-4">
            {item}
            {index < announcementItems.length - 1 && (
              <span className="hidden text-white/50 md:inline">•</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
