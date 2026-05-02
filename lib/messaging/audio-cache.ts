// Cache layer for ElevenLabs TTS — common phrases get stored in Supabase
// Storage so we don't pay to regenerate "Hola" / "Buenos días" every time.
// Cache key is a hash of (voice_id + text), so the same phrase spoken in a
// different voice (Phase 2) gets its own MP3.

import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { textToSpeech } from "@/lib/messaging/elevenlabs";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";
const CACHE_PREFIX = "audio/cache";

function cacheKey(text: string, voiceId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${voiceId}::${text.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `${CACHE_PREFIX}/${voiceId}/${hash}.mp3`;
}

export interface AudioResult {
  publicUrl: string;
  fromCache: boolean;
  charactersGenerated: number;
}

// Returns a public URL to an MP3 of the phrase. If the phrase was cached,
// `fromCache` is true and `charactersGenerated` is 0 (no API spend).
// Otherwise the function generates via ElevenLabs, uploads to Supabase
// Storage, and returns the new URL.
export async function getOrCreateAudio(
  text: string,
  voiceId?: string,
): Promise<AudioResult> {
  const resolvedVoice =
    voiceId ?? process.env.ELEVENLABS_CHIA_VOICE_ID;
  if (!resolvedVoice) {
    throw new Error("No voice ID provided and ELEVENLABS_CHIA_VOICE_ID is not set");
  }

  const sb = getAdminClient();
  const key = cacheKey(text, resolvedVoice);

  // Cache hit?
  const { data: existing } = await sb.storage.from(BUCKET).list(
    key.split("/").slice(0, -1).join("/"),
    { search: key.split("/").pop() },
  );
  if (existing && existing.length > 0) {
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key);
    return {
      publicUrl: pub.publicUrl,
      fromCache: true,
      charactersGenerated: 0,
    };
  }

  // Cache miss → generate, upload, return.
  const mp3 = await textToSpeech(text, { voiceId: resolvedVoice });
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(key, mp3, { contentType: "audio/mpeg", upsert: true });
  if (upErr) {
    throw new Error(`audio upload failed: ${upErr.message}`);
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key);
  return {
    publicUrl: pub.publicUrl,
    fromCache: false,
    charactersGenerated: text.length,
  };
}
