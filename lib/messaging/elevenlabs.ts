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
      // eleven_multilingual_v2 handles Spanish well and is reliable.
      // eleven_v3 is more expressive when available — switch via env.
      model_id:
        options.modelId ?? process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2",
      voice_settings: {
        // Lower stability → more emotional variation per generation.
        // 0.35 is the sweet spot for warmth without sounding inconsistent.
        stability: options.stability ?? 0.35,
        // Higher similarity → stays closer to the original voice's identity.
        similarity_boost: options.similarity ?? 0.8,
        // Style boosts exaggeration of voice character. 0.55 gives noticeable
        // personality without making her sound theatrical.
        style: options.style ?? 0.55,
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

