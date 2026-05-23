// Short-link redirect endpoint. Students receive
// chiachat.com/c/<short> in WhatsApp and tapping it lands here.
// We resolve the short_id → target path and 302 to it.
//
// Doesn't authenticate — the redirect target itself carries the
// signed magic-link token, so this layer is just a URL-shortening
// indirection.

import { NextResponse, type NextRequest } from "next/server";
import { resolveShortLink } from "@/lib/account/short-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { short: string } },
) {
  const targetPath = await resolveShortLink(params.short);
  if (!targetPath) {
    // Expired or unknown id — bounce to the homepage with a
    // hint. We don't show a custom expired-link UI here; the
    // /account/[token] page already has one for the
    // post-token-validation case.
    return NextResponse.redirect(
      new URL("/?link=expired", _request.url),
      { status: 302 },
    );
  }

  // Compose absolute redirect URL from the env base + relative path.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(_request.url).origin;
  const url = `${base.replace(/\/+$/, "")}${targetPath.startsWith("/") ? targetPath : "/" + targetPath}`;
  return NextResponse.redirect(url, { status: 302 });
}
