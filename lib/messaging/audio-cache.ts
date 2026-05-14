// Cache layer for ElevenLabs TTS — common phrases get stored in Supabase
// Storage so we don't pay to regenerate "Hola" / "Buenos días" every time.
// Cache key is a hash of (voice_id + text), so the same phrase spoken in a
// different voice (Phase 2) gets its own MP3.

import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { textToSpeech } from "@/lib/messaging/elevenlabs";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";
const CACHE_PREFIX = "audio/cache";

// Bump this any time we change voice settings (stability/style/model/etc).
// Existing cached MP3s become orphaned; new generations pick up the new
// settings. Storage cleanup is manual via Supabase dashboard.
const CACHE_VERSION = "v2";

// Cache key includes speed ONLY when not 1.0 so existing cached
// MP3s (which were all speed=1.0) keep their hash and stay valid.
// Slow variants get a "::s0.85" segment that produces a distinct
// hash, so we cache them separately.
function cacheKey(text: string, voiceId: string, speed: number): string {
  const speedSuffix = speed === 1.0 ? "" : `::s${speed}`;
  const hash = crypto
    .createHash("sha256")
    .update(
      `${CACHE_VERSION}::${voiceId}${speedSuffix}::${text.trim().toLowerCase()}`,
    )
    .digest("hex")
    .slice(0, 16);
  return `${CACHE_PREFIX}/${voiceId}/${hash}.mp3`;
}

export interface AudioResult {
  publicUrl: string;
  fromCache: boolean;
  charactersGenerated: number;
}

export interface GetAudioOptions {
  voiceId?: string;
  // Playback speed. 1.0 = normal (default), 0.85 = slower (used for
  // pronunciation correction in voice-note handler). 0.7-1.2 range.
  speed?: number;
}

// Returns a public URL to an MP3 of the phrase. If the phrase was cached,
// `fromCache` is true and `charactersGenerated` is 0 (no API spend).
// Otherwise the function generates via ElevenLabs, uploads to Supabase
// Storage, and returns the new URL.
//
// Speed-variant calls cache to a distinct path so a slow "Hola" is a
// different file from a normal "Hola".
//
// Backward-compat: older callers that pass voiceId as a string still
// work — the second positional arg is treated as voiceId.
export async function getOrCreateAudio(
  text: string,
  options: GetAudioOptions | string = {},
): Promise<AudioResult> {
  // Accept either an options object (preferred) or a bare voiceId
  // string (legacy callers — still used by prewarm script).
  const opts: GetAudioOptions =
    typeof options === "string" ? { voiceId: options } : options;
  const resolvedVoice =
    opts.voiceId ?? process.env.ELEVENLABS_CHIA_VOICE_ID;
  if (!resolvedVoice) {
    throw new Error("No voice ID provided and ELEVENLABS_CHIA_VOICE_ID is not set");
  }
  const speed = opts.speed ?? 1.0;

  const sb = getAdminClient();
  const key = cacheKey(text, resolvedVoice, speed);

  // Cache hit?
  const { data: existing } = await sb.storage.from(BUCKET).list(
    key.split("/").slice(0, -1).join("/"),
    { search: key.split("/").pop() },
  );
  if (existing && existing.length > 0) {
    const url = await signedUrl(sb, key);
    return { publicUrl: url, fromCache: true, charactersGenerated: 0 };
  }

  // Cache miss → generate, upload, return.
  const mp3 = await textToSpeech(text, { voiceId: resolvedVoice, speed });
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(key, mp3, { contentType: "audio/mpeg", upsert: true });
  if (upErr) {
    throw new Error(`audio upload failed: ${upErr.message}`);
  }

  const url = await signedUrl(sb, key);
  return { publicUrl: url, fromCache: false, charactersGenerated: text.length };
}

// 1-hour signed URL — Meta downloads the audio within seconds of receiving
// the send-message API call, so any short expiry works. The bucket stays
// private so no random scraper can enumerate cached phrases.
async function signedUrl(
  sb: ReturnType<typeof getAdminClient>,
  path: string,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data) {
    throw new Error(`signedUrl failed: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}
