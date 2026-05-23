// Generate per-lesson audio:
//   1. For each Spanish lesson missing content.audio_script:
//      ask GPT-4o-mini for a Spanish-only TTS script that reads the
//      lesson's items aloud + ends with ONE short example sentence,
//      and save it back to lessons.content.audio_script.
//   2. For each lesson with audio_script not yet in the ElevenLabs
//      cache: generate via ElevenLabs and upload to Supabase Storage
//      using the same cacheKey scheme as lib/messaging/audio-cache.ts.
//
// Idempotent — safe to re-run. Cache hits and pre-existing
// audio_scripts are skipped.
//
// Usage:
//   node scripts/generate-lesson-audio.mjs
//   node scripts/generate-lesson-audio.mjs --level=beginner
//   node scripts/generate-lesson-audio.mjs --limit=5
//   node scripts/generate-lesson-audio.mjs --dry-run
//   node scripts/generate-lesson-audio.mjs --tts-only   # skip script regen
//   node scripts/generate-lesson-audio.mjs --script-only # skip TTS upload
//
// Cost ballpark: 84 lessons × ~50 input tokens × GPT-4o-mini ≈ $0.05
//                84 lessons × ~120 chars × ElevenLabs Creator pricing ≈ $3-5
// Total ≈ $5 for the entire 84-lesson catalog.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CACHE_VERSION = "v2"; // MUST match lib/messaging/audio-cache.ts

// ── env ─────────────────────────────────────────────────────────────
function loadDotenv(path = ".env.local") {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key]) continue;
      let value = raw;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (e) {
    console.warn(`[dotenv] could not read ${path}:`, e.message);
  }
}
loadDotenv();

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
);
const filterLevel = args.level;
const limitN = args.limit ? Number.parseInt(args.limit, 10) : Infinity;
const dryRun = !!args["dry-run"];
const ttsOnly = !!args["tts-only"];
const scriptOnly = !!args["script-only"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_CHIA_VOICE_ID;
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY (needed for audio_script generation)");
  process.exit(1);
}
if (!ttsOnly && !scriptOnly && (!ELEVENLABS_API_KEY || !VOICE_ID)) {
  console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_CHIA_VOICE_ID");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Cache-key helper (mirror of lib/messaging/audio-cache.ts) ──────
function cacheKey(text, voiceId, speed = 1.0) {
  const speedSuffix = speed === 1.0 ? "" : `::s${speed}`;
  const hash = crypto
    .createHash("sha256")
    .update(`${CACHE_VERSION}::${voiceId}${speedSuffix}::${text.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `audio/cache/${voiceId}/${hash}.mp3`;
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

// ── GPT: build the Spanish-only audio script ───────────────────────
const SCRIPT_SYSTEM = `You write SPANISH-ONLY text-to-speech scripts for a Spanish language lesson. The script will be spoken aloud to language learners. Strict rules:

- 100% Spanish. Zero English.
- Read each lesson item clearly, in sequence, with a period or comma between for a natural pause.
- End with ONE short, natural example sentence in Spanish that demonstrates the lesson's concept. Prefix the example with "Por ejemplo:".
- Total length: 30-80 words. Stay terse.
- No headers, no introductions like "Hola, escucha", no "Aquí están los...". Just the items + the example.
- Use natural sentence flow (not bullet lists).
- Preserve accents (á é í ó ú ñ) exactly.

Output JSON: {"audio_script": "..."}`;

async function generateScript(lesson) {
  const items = (lesson.content?.items ?? [])
    .filter((it) => (it.type === "vocabulary" || it.type === "phrase" || it.type === "conjugation") && it.target_language)
    .slice(0, 10)
    .map((it) => it.target_language);
  if (items.length === 0) {
    // Fallback: derive from title + focus only.
    items.push(lesson.title);
  }
  const focus = lesson.content?.items?.[0]?.notes ?? lesson.focus ?? "";

  const userPrompt = `Lesson title: ${lesson.title}
CEFR-level: ${lesson.level}
Items to read aloud (in order):
${items.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Topic context: ${focus}

Write the Spanish-only TTS script. Output JSON.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 250,
      messages: [
        { role: "system", content: SCRIPT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const script = (parsed.audio_script ?? "").trim();
  if (!script || script.length < 5) throw new Error("empty audio_script");
  return script;
}

// ── ElevenLabs: generate the audio ─────────────────────────────────
async function elevenlabsTTS(text) {
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
  return Buffer.from(await res.arrayBuffer());
}

// ── Main ───────────────────────────────────────────────────────────
let query = sb.from("lessons").select("id, title, level, topic, lesson_number, content").eq("language", "Spanish").order("level", { ascending: true }).order("topic", { ascending: true }).order("lesson_number", { ascending: true });
if (filterLevel) query = query.eq("level", filterLevel);
const { data: lessons, error: fetchErr } = await query;
if (fetchErr) {
  console.error("[lesson-audio] fetch failed:", fetchErr.message);
  process.exit(1);
}

console.log(
  `[lesson-audio] ${lessons.length} lessons${filterLevel ? ` (filtered to level=${filterLevel})` : ""}${dryRun ? " — DRY RUN" : ""}${ttsOnly ? " — TTS only" : ""}${scriptOnly ? " — script only" : ""}`,
);

let scriptGenerated = 0;
let scriptSkipped = 0;
let audioGenerated = 0;
let audioSkipped = 0;
let failed = 0;

for (const lesson of lessons) {
  if (scriptGenerated + scriptSkipped + audioGenerated + audioSkipped + failed >= limitN * 2) break;

  const label = `${lesson.level} ${lesson.topic}:${lesson.lesson_number}`;
  let content = lesson.content ?? {};
  let audioScript = content.audio_script ?? null;

  // Phase 1: audio_script.
  if (!ttsOnly) {
    if (audioScript) {
      console.log(`[skip-script] ${label} — already has audio_script`);
      scriptSkipped++;
    } else {
      process.stdout.write(`[gen-script]  ${label}… `);
      try {
        audioScript = await generateScript(lesson);
        if (!dryRun) {
          const newContent = { ...content, audio_script: audioScript };
          const { error: upErr } = await sb
            .from("lessons")
            .update({ content: newContent })
            .eq("id", lesson.id);
          if (upErr) throw new Error(`db: ${upErr.message}`);
          content = newContent;
        }
        console.log(`✓ "${audioScript.slice(0, 60)}${audioScript.length > 60 ? "…" : ""}"`);
        scriptGenerated++;
      } catch (err) {
        console.log(`✗ ${err.message}`);
        failed++;
        continue;
      }
    }
  }

  // Phase 2: TTS.
  if (!scriptOnly && audioScript) {
    const key = cacheKey(audioScript, VOICE_ID, 1.0);
    const exists = await alreadyCached(key);
    if (exists) {
      console.log(`[skip-audio]  ${label} — cached at ${key.split("/").pop()}`);
      audioSkipped++;
      continue;
    }
    if (dryRun) {
      console.log(`[would-tts]   ${label} → ${key.split("/").pop()}`);
      audioGenerated++;
      continue;
    }
    process.stdout.write(`[gen-audio]   ${label}… `);
    try {
      const mp3 = await elevenlabsTTS(audioScript);
      await uploadMp3(key, mp3);
      console.log(`✓ ${mp3.length} bytes`);
      audioGenerated++;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      failed++;
    }
  }
}

console.log(
  `\n[lesson-audio] done. ` +
    `script_gen=${scriptGenerated} script_skip=${scriptSkipped} ` +
    `audio_gen=${audioGenerated} audio_skip=${audioSkipped} failed=${failed}`,
);
