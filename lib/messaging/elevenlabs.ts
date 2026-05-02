// Thin ElevenLabs client — TTS only. We use OpenAI Whisper for STT instead
// of ElevenLabs's Conversational Agent (the agent requires WebSocket
// streaming which doesn't fit Vercel's serverless model). The agent can
// be re-introduced in Phase 2 if we move to a long-running worker.

const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

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

