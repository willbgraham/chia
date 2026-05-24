"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Meta (Facebook) Pixel for ad attribution.
// - Auto-fires PageView on every public route load
// - Listens globally for [data-track] attributes on anchors/buttons
//   so we can fire conversion events (e.g., Lead, Purchase) from
//   server components without refactoring them into client islands.
//
// To track an event from any element, just add data-track:
//   <a href="..." data-track="Lead" data-track-label="hero-cta">
//
// The Pixel ID is read from NEXT_PUBLIC_META_PIXEL_ID. If unset, the
// component renders nothing and click handlers are no-ops — safe to
// leave mounted in dev or on previews where you don't want to ping Meta.
//
// Internal/private routes (admin dashboards, signed magic-link student
// account pages, the short-link redirect surface) are EXCLUDED so:
//   1. Admin browsing doesn't inflate the PageView count and pollute
//      ad-attribution data (a real problem — early data showed admin
//      visits accounting for ~70% of recorded PageViews)
//   2. We don't ping Meta with URLs that could leak token paths via
//      Referer or just be unnecessary tracking of authenticated users
const INTERNAL_PATH_PREFIXES = ["/admin", "/account", "/c/", "/api"];

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function MetaPixel() {
  const pathname = usePathname() ?? "/";
  const isInternal = INTERNAL_PATH_PREFIXES.some((p) =>
    pathname.startsWith(p),
  );

  useEffect(() => {
    if (!PIXEL_ID || isInternal) return;
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-track]",
      );
      if (!el || !window.fbq) return;
      const event = el.getAttribute("data-track");
      const label = el.getAttribute("data-track-label") ?? undefined;
      if (!event) return;
      try {
        if (label) {
          window.fbq("track", event, { content_name: label });
        } else {
          window.fbq("track", event);
        }
      } catch {
        // never let analytics break a click
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [isInternal]);

  if (!PIXEL_ID || isInternal) return null;

  return (
    <>
      <Script id="meta-pixel-init" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
