import type { Metadata } from "next";
import "./globals.css";
import { MetaPixel } from "@/components/MetaPixel";

export const metadata: Metadata = {
  title: {
    default: "ChiaChat — Chat your way to fluency in Spanish",
    template: "%s — ChiaChat",
  },
  description:
    "Learn Spanish on WhatsApp. Chat with Chia, a teacher from Valencia. No classrooms, no textbooks — just conversation.",
  openGraph: {
    title: "ChiaChat — Chat your way to fluency in Spanish",
    description:
      "Learn Spanish on WhatsApp. Chat with Chia, a teacher from Valencia. No classrooms, no textbooks — just conversation.",
    siteName: "ChiaChat",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ChiaChat — Learn Spanish by chatting",
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
