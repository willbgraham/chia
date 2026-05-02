// Thin client for Meta WhatsApp Cloud API.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference

const API_VERSION = "v21.0";

function endpoint(path: string): string {
  return `https://graph.facebook.com/${API_VERSION}/${path}`;
}

function authHeaders(): Record<string, string> {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("META_WHATSAPP_ACCESS_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function phoneNumberId(): string {
  const id = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error("META_WHATSAPP_PHONE_NUMBER_ID is not set");
  return id;
}

// Strip the leading + from a number (Meta wants E.164 without +).
function recipient(toNumber: string): string {
  return toNumber.startsWith("+") ? toNumber.slice(1) : toNumber;
}

interface SendResult {
  message_id?: string;
  error?: string;
}

export async function sendText(
  toNumber: string,
  body: string,
): Promise<SendResult> {
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "text",
      text: { body, preview_url: false },
    }),
  });
  return parseSendResponse(res);
}

export async function sendAudio(
  toNumber: string,
  audioUrl: string,
): Promise<SendResult> {
  // Audio can be sent via uploaded media id OR a public URL. We use URL
  // because we upload to Supabase Storage and have public URLs available.
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "audio",
      audio: { link: audioUrl },
    }),
  });
  return parseSendResponse(res);
}

interface TemplateVariable {
  type: "text";
  text: string;
}

export async function sendTemplate(
  toNumber: string,
  templateName: string,
  language: string,
  bodyVariables: string[],
): Promise<SendResult> {
  const parameters: TemplateVariable[] = bodyVariables.map((text) => ({
    type: "text",
    text,
  }));
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components: parameters.length
          ? [{ type: "body", parameters }]
          : [],
      },
    }),
  });
  return parseSendResponse(res);
}

// Resolve a media_id (from inbound audio messages) to a downloadable URL.
// Meta returns a short-lived signed URL we can fetch directly.
export async function fetchMediaUrl(mediaId: string): Promise<string | null> {
  const res = await fetch(endpoint(mediaId), { headers: authHeaders() });
  if (!res.ok) return null;
  const json = (await res.json()) as { url?: string };
  return json.url ?? null;
}

// Download the actual audio bytes from a Meta media URL. Requires the
// access token in the Authorization header (the URL is signed but Meta
// also gates content on the token).
export async function downloadMedia(mediaUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`media download failed: ${res.status}`);
  }
  return res.arrayBuffer();
}

async function parseSendResponse(res: Response): Promise<SendResult> {
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status} ${text}` };
  }
  const j = (await res.json()) as { messages?: Array<{ id: string }> };
  return { message_id: j.messages?.[0]?.id };
}
