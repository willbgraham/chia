/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },

  // Security headers. Applied to every response globally, with /account/*
  // tightened further (no-referrer) since magic-link tokens live in the
  // URL path and we don't want them leaking via Referer on outbound link
  // clicks (Stripe Portal, WhatsApp deep links, etc.).
  async headers() {
    const baseHeaders = [
      // Clickjacking protection. frame-ancestors 'none' is the CSP-native
      // equivalent and supersedes X-Frame-Options on modern browsers; we
      // set both for belt-and-suspenders.
      {
        key: "Content-Security-Policy",
        value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self';",
      },
      { key: "X-Frame-Options", value: "DENY" },
      // Tell browsers to trust the declared Content-Type and not sniff
      // (mitigates SVG-as-HTML / HTML-as-image XSS gadgets).
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Block legacy IE-style "MIME confusion" abuse + XSS auditor side
      // effects. Modern browsers ignore this header — kept for old Edge.
      { key: "X-XSS-Protection", value: "0" },
      // HSTS — 2 years, include subdomains, eligible for browser preload.
      // Vercel terminates TLS, so this is safe to set unconditionally.
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      // Default Referrer-Policy for the rest of the site. /account/* is
      // overridden below to no-referrer because tokens are in the path.
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      // Lock down powerful browser APIs we never use. Adjust if/when we
      // add features that legitimately need camera/mic/etc.
      {
        key: "Permissions-Policy",
        value:
          "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
      },
    ];

    return [
      {
        // Global default.
        source: "/:path*",
        headers: baseHeaders,
      },
      {
        // Tighten Referrer-Policy for the magic-link token routes so the
        // signed token in the URL path can't be exfiltrated via Referer
        // to third-party resources (Stripe Portal, external links, etc.).
        source: "/account/:path*",
        headers: [
          ...baseHeaders.filter((h) => h.key !== "Referrer-Policy"),
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Same as /account but for the /c/<short> redirect surface — the
        // short link maps to an /account URL with the token, and a stray
        // Referer leak here is just as bad.
        source: "/c/:path*",
        headers: [
          ...baseHeaders.filter((h) => h.key !== "Referrer-Policy"),
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
