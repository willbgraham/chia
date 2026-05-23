import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { handleInbound, type InboundMessage } from "@/lib/handlers/route-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 60s for the full inbound processing chain (Supabase reads,
// GPT call, Meta send, audio gen if applicable). Vercel's hobby plan
// caps at 10s; production needs Pro for this.
export const maxDuration = 60;

// Inbound webhook from Meta WhatsApp Cloud API.
//
// GET  — handshake on initial webhook setup. Echoes hub.challenge if the
//        verify token matches.
// POST — every inbound user message. We HMAC-verify it's really Meta,
//        parse the payload, and invoke the conversation router.

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

  if (!signature || !verifyMetaSignature(signature, rawBody, appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Parse Meta's nested payload, route each message inside it.
  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Extract every inbound message from the payload (Meta batches them by
  // entry → changes → value → messages[]). For ChiaChat at typical scale,
  // there's one message per webhook, but the spec supports multiple.
  const messages = extractMessages(payload);

  // Process each message. Don't fail Meta on a single processing error —
  // log and move on so Meta doesn't retry the whole batch.
  await Promise.all(
    messages.map(async (msg) => {
      try {
        await handleInbound(msg);
      } catch (err) {
        // Mask the phone number before logging so a stray Vercel log
        // (or any ingest pipeline downstream — Datadog/Sentry/etc.)
        // doesn't end up holding E.164 numbers in plaintext.
        const { maskWhatsAppNumber } = await import("@/lib/utils");
        const safeMsg = {
          ...msg,
          whatsappNumber: maskWhatsAppNumber(msg.whatsappNumber),
        };
        console.error("[whatsapp inbound] handler error:", err, "msg:", safeMsg);
      }
    }),
  );

  return NextResponse.json({ received: messages.length });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function verifyMetaSignature(
  header: string,
  rawBody: string,
  appSecret: string,
): boolean {
  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface MetaMessage {
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  image?: { id: string };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        messages?: MetaMessage[];
      };
      field?: string;
    }>;
  }>;
}

function extractMessages(payload: MetaWebhookPayload): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        // Meta sends 'from' without leading +, we store with +.
        const whatsappNumber = m.from.startsWith("+") ? m.from : `+${m.from}`;
        if (m.type === "text" && m.text) {
          out.push({
            whatsappNumber,
            type: "text",
            textBody: m.text.body,
          });
        } else if (m.type === "audio" && m.audio) {
          out.push({
            whatsappNumber,
            type: "audio",
            audioMediaId: m.audio.id,
          });
        } else if (m.type === "image" && m.image) {
          out.push({ whatsappNumber, type: "image" });
        } else if (
          m.type === "interactive" &&
          m.interactive?.type === "button_reply" &&
          m.interactive.button_reply
        ) {
          // Student tapped a button in an interactive message (e.g.,
          // a pop-quiz answer). We surface this as a button_reply
          // event with the chosen option id for grading.
          out.push({
            whatsappNumber,
            type: "button_reply",
            buttonReplyId: m.interactive.button_reply.id,
            buttonReplyTitle: m.interactive.button_reply.title,
          });
        } else if (
          m.type === "interactive" &&
          m.interactive?.type === "list_reply" &&
          m.interactive.list_reply
        ) {
          // Student picked a row from an interactive list message
          // (used for 4-7 option MCQs in the end-of-lesson quiz).
          // We collapse this into the same button_reply shape so
          // downstream handlers don't have to care about the
          // distinction — they just see the picked option id.
          out.push({
            whatsappNumber,
            type: "button_reply",
            buttonReplyId: m.interactive.list_reply.id,
            buttonReplyTitle: m.interactive.list_reply.title,
          });
        } else {
          out.push({ whatsappNumber, type: "other" });
        }
      }
    }
  }
  return out;
}
