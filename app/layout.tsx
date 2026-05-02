import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ChiaChat Admin",
    template: "%s — ChiaChat Admin",
  },
  description:
    "ChiaChat is a WhatsApp-native Spanish teacher. Chat with Chia, learn naturally, speak Spanish. No classrooms. No textbooks. Just conversation.",
  openGraph: {
    title: "ChiaChat — Chat your way to fluency",
    description:
      "ChiaChat is a WhatsApp-native Spanish teacher. Chat with Chia, learn naturally, speak Spanish.",
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
      <body className="min-h-screen bg-bg text-text font-sans">{children}</body>
    </html>
  );
}
