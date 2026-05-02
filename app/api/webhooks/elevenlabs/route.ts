import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import type {
  ElevenLabsWebhookBody,
  MemoryJson,
  ConversationStateName,
} from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bridge between the ElevenLabs Conversational Agent (which owns the
// audio loop on WhatsApp) and the rest of the system. Called once after
// each voice exchange. Logs audio usage, merges pronunciation notes
// into memory, flips conversation_state back to an active text state.
export async function POST(request: NextRequest) {
  const sharedSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!sharedSecret) {
    return NextResponse.json(
      { error: "ELEVENLABS_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (token !== sharedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ElevenLabsWebhookBody;
  try {
    body = (await request.json()) as ElevenLabsWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { whatsapp_number, transcription, agent_response, characters_used } =
    body;
  if (!whatsapp_number) {
    return NextResponse.json(
      { error: "whatsapp_number required" },
      { status: 400 },
    );
  }

  const sb = getAdminClient();
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, memory_json")
    .eq("whatsapp_number", whatsapp_number)
    .single();

  if (userErr || !user) {
    return NextResponse.json(
      { error: `user not found for ${whatsapp_number}` },
      { status: 404 },
    );
  }

  const sttChars = characters_used?.stt ?? 0;
  const ttsChars = characters_used?.tts ?? 0;
  const total = sttChars + ttsChars;

  // 1. Log audio usage. STT counts as inbound (the user's voice note
  // transcribed), TTS counts as outbound (Chia's spoken reply).
  const usageRows: Array<{
    user_id: string;
    characters_used: number;
    source: "elevenlabs_agent";
    direction: "inbound" | "outbound";
  }> = [];
  if (sttChars > 0) {
    usageRows.push({
      user_id: user.id,
      characters_used: sttChars,
      source: "elevenlabs_agent",
      direction: "inbound",
    });
  }
  if (ttsChars > 0) {
    usageRows.push({
      user_id: user.id,
      characters_used: ttsChars,
      source: "elevenlabs_agent",
      direction: "outbound",
    });
  }
  if (usageRows.length > 0) {
    const { error: usageErr } = await sb.from("audio_usage").insert(usageRows);
    if (usageErr) {
      return NextResponse.json(
        { error: `audio_usage insert failed: ${usageErr.message}` },
        { status: 500 },
      );
    }
  }

  // 2. Merge a pronunciation note into memory if we have something
  // meaningful from the exchange.
  const note = derivePronunciationNote(transcription, agent_response);
  const memory: MemoryJson = (user.memory_json as MemoryJson | null) ?? {};
  if (note) {
    memory.language_progress = memory.language_progress ?? {};
    const existing = memory.language_progress.pronunciation_notes ?? [];
    memory.language_progress.pronunciation_notes = [...existing, note].slice(
      -50,
    );
  }
  memory.last_session = new Date().toISOString();

  const { error: memErr } = await sb
    .from("users")
    .update({ memory_json: memory })
    .eq("id", user.id);
  if (memErr) {
    return NextResponse.json(
      { error: `memory update failed: ${memErr.message}` },
      { status: 500 },
    );
  }

  // 3. Flip conversation state back to an active text state. Pick the
  // structured branch if the user has an active curriculum position.
  const nextState: ConversationStateName =
    memory.lesson_mode === "free"
      ? "active_free_chat"
      : memory.curriculum_position?.current_lesson
        ? "active_structured_lesson"
        : "active_free_chat";

  const { error: stateErr } = await sb
    .from("conversation_state")
    .update({
      state: nextState,
      pending_phrase: null,
      pending_audio_url: null,
      last_message_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (stateErr) {
    return NextResponse.json(
      { error: `state update failed: ${stateErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    received: true,
    user_id: user.id,
    state: nextState,
    audio_chars_logged: total,
  });
}

// Crude but useful: store the transcription paired with Chia's
// correction so the next text turn can reference it. The Make memory
// updater scenario rewrites/distills these into proper weak_points later.
function derivePronunciationNote(
  transcription: string | undefined,
  agentResponse: string | undefined,
): string | null {
  const t = transcription?.trim();
  const a = agentResponse?.trim();
  if (!t && !a) return null;
  const stamp = new Date().toISOString();
  return `[${stamp}] said: "${t ?? ""}" — feedback: "${a ?? ""}"`;
}
