import type { MetadataRoute } from "next";

// Phase G SEO pass: web app manifest (node_modules/next/dist/docs/.../
// manifest.md). Icons reference the same file-convention icon and
// apple-icon routes defined alongside this file, so there's one source
// of truth for the brand monogram.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DAAKYKA Apparels",
    short_name: "DAAKYKA",
    description:
      "Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad, Pan India delivery.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#8A347D",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
