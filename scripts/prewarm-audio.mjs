// Pre-warm the ElevenLabs TTS audio cache for the onboarding voice
// intro (and any other always-on phrases). Run once after deploy or
// after bumping CACHE_VERSION in audio-cache.ts.
//
// Usage:
//   node scripts/prewarm-audio.mjs
//
// Reads env from .env.local automatically. Idempotent — if the cached
// MP3 already exists for the phrase + voice + version, it's skipped.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── Mirror of CACHE_VERSION in lib/messaging/audio-cache.ts ───────
// Bump this here at the same time you bump it there.
const CACHE_VERSION = "v2";

// Phrases worth pre-warming (Spanish target language). Add more as
// they emerge as common onboarding/lesson openers.
const PHRASES = [
  "Hola, soy Chia. Bienvenido a ChiaChat. Vamos a aprender español juntos.",
];

// ── Tiny dotenv loader (no extra dep) ──────────────────────────────
function loadDotenv(path = ".env.local") {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key]) continue; // don't clobber what's already set
      let value = rawValue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (e) {
    console.warn(`[prewarm] could not read ${path}:`, e.message);
  }
}

loadDotenv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_CHIA_VOICE_ID;
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!ELEVENLABS_API_KEY || !VOICE_ID) {
  console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_CHIA_VOICE_ID");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function cacheKey(text, voiceId) {
  const hash = crypto
    .createHash("sha256")
    .update(`${CACHE_VERSION}::${voiceId}::${text.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `audio/cache/${voiceId}/${hash}.mp3`;
}

async function elevenlabsTTS(text) {
  // Match production exactly — same output_format, voice_settings, model.
  // See lib/messaging/elevenlabs.ts.
  const params = new URLSearchParams({ output_format: "mp3_44100_128" });
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?${params}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.8,
        style: 0.55,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function alreadyCached(key) {
  const dir = key.split("/").slice(0, -1).join("/");
  const file = key.split("/").pop();
  const { data } = await sb.storage.from(BUCKET).list(dir, { search: file });
  return Array.isArray(data) && data.length > 0;
}

async function uploadMp3(key, buf) {
  const { error } = await sb.storage.from(BUCKET).upload(key, buf, {
    contentType: "audio/mpeg",
    upsert: true,
  });
  if (error) throw new Error(`upload: ${error.message}`);
}

let warmed = 0;
let skipped = 0;
for (const phrase of PHRASES) {
  const key = cacheKey(phrase, VOICE_ID);
  process.stdout.write(`[prewarm] "${phrase.slice(0, 60)}..."\n  → ${key}\n  `);

  const exists = await alreadyCached(key);
  if (exists) {
    console.log("✓ already cached, skipped");
    skipped++;
    continue;
  }

  process.stdout.write("generating via ElevenLabs… ");
  const mp3 = await elevenlabsTTS(phrase);
  process.stdout.write(`got ${mp3.length} bytes; uploading… `);
  await uploadMp3(key, mp3);
  console.log("✓ cached");
  warmed++;
}

console.log(
  `\n[prewarm] done. warmed=${warmed} skipped=${skipped} total=${PHRASES.length}`,
);
