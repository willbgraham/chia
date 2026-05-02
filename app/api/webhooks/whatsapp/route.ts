import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bridge between Meta WhatsApp Cloud API and Make.com.
//
// GET  — handles Meta's webhook verification handshake. Meta calls this
//        once during webhook setup with `?hub.mode=subscribe&hub.verify_token=
//        <token>&hub.challenge=<random>`. We compare the token to our stored
//        secret and echo the challenge if it matches.
//
// POST — every inbound user message lands here from Meta. We:
//        1. Verify the X-Hub-Signature-256 HMAC so we know it's really Meta.
//        2. Forward the raw payload to the Make scenario 1 webhook URL.
//        3. Return 200 to Meta immediately (Meta retries on non-2xx, and we
//           don't want to gate Meta's queue on Make's processing time).

export async function GET(request: NextRequest) {
  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return new NextResponse("verify token not configured", { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === expected && challenge) {
    // Meta wants the challenge echoed back as plain text with 200.
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("verification failed", { status: 403 });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json(
      { error: "META_WHATSAPP_APP_SECRET not configured" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("x-hub-signature-256");
  const rawBody = await request.text();

  // HMAC verification — protects against forged Meta webhooks.
  if (!signature || !verifyMetaSignature(signature, rawBody, appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Forward to Make scenario 1. Fire-and-forget so we return 200 to Meta
  // fast even if Make is slow.
  const makeUrl = process.env.MAKE_WHATSAPP_WEBHOOK_URL;
  if (makeUrl) {
    // Don't await — return to Meta immediately; let the forward complete
    // in the background. If it fails, log and move on (Meta won't retry,
    // we'll see the failure in Vercel logs).
    void forwardToMake(makeUrl, rawBody, request.headers).catch((err) => {
      console.error("[whatsapp passthrough] forward to Make failed:", err);
    });
  } else {
    console.warn(
      "[whatsapp passthrough] MAKE_WHATSAPP_WEBHOOK_URL not set — payload received but not forwarded",
    );
  }

  return NextResponse.json({ received: true });
}

function verifyMetaSignature(
  header: string,
  rawBody: string,
  appSecret: string,
): boolean {
  // header looks like: "sha256=abcd1234..."
  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;

  // Constant-time compare to prevent timing attacks.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function forwardToMake(
  url: string,
  rawBody: string,
  incomingHeaders: Headers,
) {
  // Forward as POST with the same content type. We deliberately don't
  // forward the X-Hub-Signature header — Make doesn't need it (we already
  // verified it), and downstream handlers won't have access to the app
  // secret to re-verify.
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":
        incomingHeaders.get("content-type") ?? "application/json",
    },
    body: rawBody,
  });
}
