"use client";

import { MessageCircle } from "lucide-react";
import { brand } from "@/data/brand";

export function WhatsAppFab() {
  const message = encodeURIComponent(brand.web.whatsappMessage);
  const href = `https://wa.me/?text=${message}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-trust text-white shadow-lg shadow-trust/30 transition hover:scale-105 hover:shadow-xl"
      aria-label="Chat on WhatsApp"
    >
      <MessageCircle size={24} />
    </a>
  );
}
