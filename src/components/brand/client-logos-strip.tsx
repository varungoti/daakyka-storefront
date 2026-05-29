import { daakykaMedia } from "@/data/media/catalog";
import Image from "next/image";

interface ClientLogosStripProps {
  title?: string;
  description?: string;
}

export function ClientLogosStrip({
  title = "Trusted by Leading Organizations",
  description = "Healthcare, education, corporate, and hospitality partners across India.",
}: ClientLogosStripProps) {
  return (
    <section className="border-y border-border bg-white py-16">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Our Clients</p>
          <h2 className="mt-3 font-display text-2xl font-bold text-ink md:text-3xl">{title}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">{description}</p>
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {daakykaMedia.clientLogos.map((client) => (
            <li
              key={client.name}
              className="flex flex-col items-center justify-center rounded-2xl border border-border bg-lavender/20 p-4"
            >
              <div className="relative h-14 w-full">
                <Image
                  src={client.src}
                  alt={client.name}
                  fill
                  className="object-contain"
                  sizes="120px"
                />
              </div>
              <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">
                {client.name}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
