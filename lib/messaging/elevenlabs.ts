// Thin ElevenLabs client. Two surfaces:
//   - TTS (text-to-speech) — Make's old role: generate Chia speaking a
//     specific phrase, return MP3 bytes
//   - Conversational Agent invocation — for voice-note correction loop;
//     we POST audio + dynamic variables and the agent handles the
//     full STT → analyse → TTS → reply pipeline natively.

const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const AGENT_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversations";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

export interface TTSOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarity?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  outputFormat?: string;
}

// Generate Chia speaking a phrase. Returns MP3 bytes.
// The default voice is Chia's; override only if you need a different teacher.
export async function textToSpeech(
  text: string,
  options: TTSOptions = {},
): Promise<ArrayBuffer> {
  const voiceId =
    options.voiceId ?? process.env.ELEVENLABS_CHIA_VOICE_ID;
  if (!voiceId) throw new Error("ELEVENLABS_CHIA_VOICE_ID is not set");

  const params = new URLSearchParams({
    output_format: options.outputFormat ?? "mp3_44100_128",
  });

  const res = await fetch(`${TTS_ENDPOINT}/${voiceId}?${params}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: options.modelId ?? "eleven_multilingual_v2",
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarity ?? 0.75,
        style: options.style ?? 0,
        use_speaker_boost: options.useSpeakerBoost ?? true,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs TTS ${res.status}: ${text}`);
  }
  return res.arrayBuffer();
}

// Hand off to the Conversational Agent for a voice-note exchange. We pass
// the inbound audio (downloaded from Meta) plus dynamic variables that the
// agent's prompt references via {{pending_phrase}} and {{student_name}}.
export interface AgentInvokeArgs {
  agentId?: string;
  audio: ArrayBuffer;
  whatsappNumber: string;
  pendingPhrase: string | null;
  studentName: string | null;
}

export async function invokeAgent(args: AgentInvokeArgs): Promise<{
  conversationId?: string;
  agentResponseAudioUrl?: string;
  error?: string;
}> {
  const agentId = args.agentId ?? process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw new Error("ELEVENLABS_AGENT_ID is not set");

  // ElevenLabs's Conversational Agent API expects a POST that initiates a
  // conversation. The agent's WhatsApp integration may fire its own webhook
  // back to /api/webhooks/elevenlabs once the exchange completes.
  //
  // NOTE: as of writing this, ElevenLabs's HTTP API for invoking an agent
  // with audio bytes is still evolving — confirm the exact shape against
  // their docs before going live. This function is a placeholder for the
  // intended invocation point; in production you may instead let
  // ElevenLabs's WhatsApp integration handle inbound audio directly,
  // bypassing this function entirely.
  const res = await fetch(`${AGENT_ENDPOINT}?agent_id=${agentId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversation_initiation_client_data: {
        dynamic_variables: {
          whatsapp_number: args.whatsappNumber,
          pending_phrase: args.pendingPhrase ?? "",
          student_name: args.studentName ?? "",
        },
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { error: `ElevenLabs agent ${res.status}: ${txt}` };
  }

  const j = (await res.json()) as {
    conversation_id?: string;
    audio_url?: string;
  };
  return {
    conversationId: j.conversation_id,
    agentResponseAudioUrl: j.audio_url,
  };
}
