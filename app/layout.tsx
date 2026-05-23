import type { Metadata } from "next";
import "./globals.css";
import { MetaPixel } from "@/components/MetaPixel";

// Anchor every relative OG/Twitter URL to the canonical production
// origin. Next emits a build-time warning without this — and social
// previews (WhatsApp/iMessage/Slack/Twitter) fall back to a generic
// placeholder when they can't resolve the image URL.
const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "ChiaChat — Chat your way to fluency in Spanish",
    template: "%s — ChiaChat",
  },
  description:
    "Learn Spanish on WhatsApp. Chat with Chia, a teacher from Valencia. Free to start, €25/month for voice and pronunciation feedback. No classrooms, no textbooks — just conversation.",
  // Authoritative URL for the homepage. Per-page metadata can override.
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ChiaChat — Chat your way to fluency in Spanish",
    description:
      "Learn Spanish on WhatsApp. Chat with Chia, a teacher from Valencia. No classrooms, no textbooks — just conversation.",
    url: SITE_URL,
    siteName: "ChiaChat",
    type: "website",
    locale: "en_US",
    // app/opengraph-image.tsx generates the actual image at runtime
    // — Next auto-injects it into the OG tags, but we set width/
    // height here so previewers that don't probe the image know
    // it's a 1200×630 large-summary card.
  },
  twitter: {
    card: "summary_large_image",
    title: "ChiaChat — Learn Spanish by chatting",
    description:
      "Chat your way to fluency in Spanish on WhatsApp. Free to try.",
  },
  // Belt-and-suspenders robots policy. app/robots.ts is the
  // authoritative robots.txt; this header complements it.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text font-sans">
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
