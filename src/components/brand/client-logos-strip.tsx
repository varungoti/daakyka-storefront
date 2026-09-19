import { ABOUT_CLIENT_LOGOS } from "@/data/media/image-manifest";
import { getSiteImages } from "@/lib/media/get-site-image";
import Image from "next/image";

interface ClientLogosStripProps {
  title?: string;
  description?: string;
}

/**
 * Real institutional clients — logos are admin-uploaded per
 * `about.client.*` manifest slot (see ABOUT_CLIENT_LOGOS,
 * src/data/media/image-manifest.ts) and never AI-generated or
 * substituted with stock imagery, since these are real companies'
 * trademarks. A client with no uploaded logo yet renders as a tasteful
 * typographic entry instead of a broken/empty image box, so the strip
 * looks deliberate at any stage of upload — including today, with zero
 * logos uploaded.
 */
export async function ClientLogosStrip({
  title = "Trusted by Leading Organizations",
  description = "Healthcare, education, corporate, and hospitality partners across India.",
}: ClientLogosStripProps) {
  const logos = await getSiteImages(ABOUT_CLIENT_LOGOS.map((client) => client.slot));

  return (
    <section className="border-y border-border bg-surface py-16">
      <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Our Clients</p>
          <h2 className="mt-3 font-display text-2xl font-bold text-ink md:text-3xl">{title}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">{description}</p>
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {ABOUT_CLIENT_LOGOS.map((client) => {
            const logo = logos[client.slot];
            return (
              <li
                key={client.name}
                className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface-muted p-4"
              >
                {logo ? (
                  <>
                    <div className="relative h-14 w-full">
                      <Image
                        src={logo.url}
                        alt={logo.alt || client.name}
                        fill
                        className="object-contain"
                        sizes="120px"
                      />
                    </div>
                    <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {client.name}
                    </p>
                  </>
                ) : (
                  // No logo uploaded yet — a typographic treatment, not a
                  // placeholder image box (a generic icon standing in for a
                  // specific real company's mark would misrepresent it).
                  <div className="flex h-14 w-full items-center justify-center">
                    <p className="text-center text-xs font-bold uppercase tracking-wide text-ink">
                      {client.name}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
