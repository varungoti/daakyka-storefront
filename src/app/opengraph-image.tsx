import { ImageResponse } from "next/og";

// Phase G SEO pass: the default site-wide Open Graph / Twitter share image
// (1200x630, per node_modules/next/dist/docs/.../opengraph-image.md).
// Product pages don't have their own opengraph-image, so this root one is
// what's used across the site — including for /products/[handle].
export const alt = "DAAKYKA Apparels — Hospital, School & Institutional Uniforms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8A347D 0%, #5D00A3 100%)",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 24,
            background: "rgba(255,255,255,0.16)",
            marginBottom: 36,
          }}
        >
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: "#FFFFFF",
              fontFamily: "Arial, Helvetica, sans-serif",
              display: "flex",
            }}
          >
            D
          </div>
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#FFFFFF",
            fontFamily: "Arial, Helvetica, sans-serif",
            letterSpacing: -1,
            display: "flex",
          }}
        >
          DAAKYKA Apparels
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 30,
            fontWeight: 500,
            color: "#FFCC00",
            fontFamily: "Arial, Helvetica, sans-serif",
            textAlign: "center",
            display: "flex",
          }}
        >
          Hospital, School &amp; Institutional Uniforms — Hyderabad
        </div>
      </div>
    ),
    { ...size },
  );
}
