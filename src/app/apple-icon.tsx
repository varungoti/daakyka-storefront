import { ImageResponse } from "next/og";

// Phase G SEO pass: the iOS home-screen icon. apple-icon only supports
// jpg/jpeg/png as a static file (see node_modules/next/dist/docs/.../
// app-icons.md), not svg, so unlike src/app/icon.svg this one has to be
// generated with next/og's ImageResponse instead of a static file.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#8A347D",
          borderRadius: 36,
        }}
      >
        <div
          style={{
            fontSize: 104,
            fontWeight: 700,
            color: "#FFFFFF",
            fontFamily: "Arial, Helvetica, sans-serif",
            display: "flex",
          }}
        >
          D
        </div>
      </div>
    ),
    { ...size },
  );
}
