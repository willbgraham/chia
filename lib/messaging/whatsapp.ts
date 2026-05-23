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

// Send an image. URL must be publicly fetchable by Meta (https, no auth).
// Optional caption renders under the image. Used for greeting photos at
// onboarding step 1 + Phase 2 mid-conversation contextual photos.
export async function sendImage(
  toNumber: string,
  imageUrl: string,
  caption?: string,
): Promise<SendResult> {
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "image",
      image: caption ? { link: imageUrl, caption } : { link: imageUrl },
    }),
  });
  return parseSendResponse(res);
}

// Send an interactive button message. Up to 3 buttons. Each button
// gets a stable id (so the inbound reply can be matched against it)
// and a title (≤20 chars — Meta enforces this strictly).
// Used for pop quizzes ("¿Cómo se dice X?" + 3 options).
export interface InteractiveButton {
  id: string;
  title: string; // ≤20 chars (Meta hard cap)
}
export async function sendInteractiveButtons(
  toNumber: string,
  bodyText: string,
  buttons: InteractiveButton[],
): Promise<SendResult> {
  if (buttons.length === 0 || buttons.length > 3) {
    return { error: `interactive buttons need 1-3 entries, got ${buttons.length}` };
  }
  // Hard-truncate titles to 20 chars to avoid Meta rejecting the
  // whole message. Callers should aim for ≤18 to leave room.
  const safeButtons = buttons.map((b) => ({
    type: "reply" as const,
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }));
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText.slice(0, 1024) },
        action: { buttons: safeButtons },
      },
    }),
  });
  return parseSendResponse(res);
}

// Send an interactive list message. Up to 10 total rows, grouped
// into one or more sections. Lists are how WhatsApp Cloud API
// supports MCQs with more than 3 options (the polls feature is
// consumer-only and not in the Business Cloud API).
//
// Meta caps: ≤10 rows across all sections, row title ≤24 chars,
// row description ≤72 chars, button label (the dropdown trigger) ≤20 chars.
// We hard-truncate so a small overage doesn't reject the entire message.
//
// Inbound: when the student taps a row, Meta sends an interactive
// message with type=list_reply containing the chosen row's id. The
// webhook parser reads it as msg.listReplyId.
export interface InteractiveListRow {
  id: string;          // ≤200 chars in payload; we trim to 200
  title: string;       // ≤24 chars (Meta cap)
  description?: string; // ≤72 chars
}
export interface InteractiveListSection {
  title: string;       // ≤24 chars
  rows: InteractiveListRow[];
}
export async function sendInteractiveList(
  toNumber: string,
  bodyText: string,
  buttonLabel: string,
  sections: InteractiveListSection[],
): Promise<SendResult> {
  const totalRows = sections.reduce((acc, s) => acc + s.rows.length, 0);
  if (totalRows === 0 || totalRows > 10) {
    return { error: `interactive list needs 1-10 rows total, got ${totalRows}` };
  }
  const safeSections = sections.map((s) => ({
    title: s.title.slice(0, 24),
    rows: s.rows.map((r) => ({
      id: r.id.slice(0, 200),
      title: r.title.slice(0, 24),
      ...(r.description ? { description: r.description.slice(0, 72) } : {}),
    })),
  }));
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText.slice(0, 1024) },
        action: {
          button: buttonLabel.slice(0, 20),
          sections: safeSections,
        },
      },
    }),
  });
  return parseSendResponse(res);
}

// Send a PDF document. URL must be publicly fetchable by Meta. Filename
// is what the recipient sees in their WhatsApp media gallery; pick
// something descriptive (e.g., "ser-conjugation.pdf"). Optional caption
// shows above the document tile.
export async function sendDocument(
  toNumber: string,
  documentUrl: string,
  filename: string,
  caption?: string,
): Promise<SendResult> {
  const res = await fetch(endpoint(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient(toNumber),
      type: "document",
      document: caption
        ? { link: documentUrl, filename, caption }
        : { link: documentUrl, filename },
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
    const errMsg = `${res.status} ${text}`;
    console.error("[whatsapp] send failed:", errMsg);
    return { error: errMsg };
  }
  const j = (await res.json()) as { messages?: Array<{ id: string }> };
  return { message_id: j.messages?.[0]?.id };
}
