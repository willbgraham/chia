import { ImageResponse } from "next/og";

// Auto-generates the OG image at /opengraph-image. Next 14 wires
// this into the homepage's <meta og:image> for free. Per-page
// opengraph-image.tsx files would override it for that route.
//
// Edge runtime keeps the cold start tiny since this just renders
// SVG-shaped JSX into a PNG via Satori under the hood.

export const runtime = "edge";
export const alt = "ChiaChat — Chat your way to fluency in Spanish";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0F1714 0%, #1B2A23 100%)",
          color: "#ECEDEB",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Brand mark + word mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 32,
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 48 }}>🌿</span>
          <span>ChiaChat</span>
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 80,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
            }}
          >
            Aprende español
          </div>
          <div
            style={{
              fontSize: 80,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              color: "#85D4AD",
            }}
          >
            talking to a friend.
          </div>
        </div>

        {/* Footer line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 28,
            color: "#9CA3A2",
          }}
        >
          <span>Spanish, by WhatsApp.</span>
          <span style={{ color: "#85D4AD" }}>chiachat.com</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
