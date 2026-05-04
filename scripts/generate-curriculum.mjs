// Bulk-generate Spanish curriculum lessons via GPT-4o.
//
// Reads data/curriculum-spec.json (a flat list of {level, topic,
// lesson_number, title, focus} entries), generates a structured
// LessonContent JSON for each via GPT-4o json mode, and inserts into
// the lessons table.
//
// Idempotent — uses (language, level, topic, lesson_number) as the
// natural key and skips entries that already exist. Resume-friendly
// for long runs / interruptions.
//
// Usage:
//   node scripts/generate-curriculum.mjs              # generate all missing
//   node scripts/generate-curriculum.mjs --level=beginner   # filter
//   node scripts/generate-curriculum.mjs --limit=5    # cap to N for testing
//   node scripts/generate-curriculum.mjs --dry-run    # log without writing
//
// Cost: ~$0.04 per lesson at GPT-4o pricing. Full A1+A2 (~30
// lessons) ≈ $1.20. Full A1→C2 (~150 lessons) ≈ $6.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── env loader ─────────────────────────────────────────────────────
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

// ── args ──────────────────────────────────────────────────────────
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
const model = process.env.CHIA_PERSONALITY_MODEL ?? "gpt-4o";

// ── supabase client ───────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── spec ──────────────────────────────────────────────────────────
const spec = JSON.parse(readFileSync("data/curriculum-spec.json", "utf8"));
let entries = spec.lessons;
if (filterLevel) entries = entries.filter((e) => e.level === filterLevel);

console.log(
  `[curriculum] ${entries.length} lessons in spec` +
    (filterLevel ? ` (filtered to level=${filterLevel})` : "") +
    (dryRun ? " — DRY RUN, no writes" : ""),
);

// ── existing lesson check ─────────────────────────────────────────
async function lessonExists(language, level, topic, lessonNumber) {
  const { data } = await sb
    .from("lessons")
    .select("id")
    .eq("language", language)
    .eq("level", level)
    .eq("topic", topic)
    .eq("lesson_number", lessonNumber)
    .maybeSingle();
  return !!data;
}

// ── GPT-4o generator ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You generate Spanish-language lesson content for ChiaChat, a WhatsApp tutor product. Output MUST be a single JSON object matching this shape:

{
  "introduction": "1-2 sentences in Chia's warm voice introducing the topic. Spanish welcome optional.",
  "items": [
    {
      "type": "vocabulary" | "phrase" | "conjugation" | "rule",
      "target_language": "the Spanish word/phrase",
      "native_language": "the English meaning",
      "pronunciation_guide": "stressed-syllable phonetic in CAPS, optional",
      "notes": "1-sentence usage tip, optional",
      "audio_worthy": true|false,
      "conjugation": { "yo": "...", "tú": "...", "él": "...", "nosotros": "...", "vosotros": "...", "ellos": "..." }   // only if type=conjugation
    }
  ],
  "summary": "1 sentence wrapping up what they just learned.",
  "practice_prompts": [
    "3-5 short practice prompts the student can use to apply this in chat."
  ]
}

Rules:
- 5-15 items per lesson. Mix types if it fits the topic.
- audio_worthy=true for items where hearing pronunciation matters (single words, phrases, conjugation tables). audio_worthy=false for abstract grammar rules.
- pronunciation_guide format: "OH-la" not "/'ola/" — keep it accessible to monolingual learners.
- For conjugation items, fill the conjugation object with all 6 persons. Only Castilian Spain forms (vosotros included).
- The introduction and summary should sound like Chia (warm, slightly informal, occasional Spanish reaction word like "vale" or "mira"). No hype. No "Great question!" / "Absolutely!".
- Practice prompts should be open-ended, not multiple choice — students will type their answers in WhatsApp.

Be terse. Don't pad.`;

async function generateLesson(entry) {
  const userPrompt = `Generate the lesson content JSON.

Language: ${spec.language}
CEFR level: ${entry.cefr}
App level: ${entry.level}
Topic: ${entry.topic}
Lesson number within topic: ${entry.lesson_number}
Title: ${entry.title}
Focus: ${entry.focus}

Return ONLY the JSON object, no surrounding text.`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

// ── main loop ──────────────────────────────────────────────────────
let generated = 0;
let skipped = 0;
let failed = 0;

for (const entry of entries) {
  if (generated + skipped + failed >= limitN) break;

  const exists = await lessonExists(
    spec.language,
    entry.level,
    entry.topic,
    entry.lesson_number,
  );
  if (exists) {
    console.log(
      `[skip] ${entry.cefr} ${entry.topic}:${entry.lesson_number} — ${entry.title}`,
    );
    skipped++;
    continue;
  }

  process.stdout.write(
    `[gen]  ${entry.cefr} ${entry.topic}:${entry.lesson_number} — ${entry.title}… `,
  );

  let content;
  try {
    content = await generateLesson(entry);
  } catch (err) {
    console.log(`✗ ${err.message}`);
    failed++;
    continue;
  }

  // Validate shape minimally — items must be a non-empty array.
  if (!Array.isArray(content.items) || content.items.length === 0) {
    console.log(`✗ malformed (no items)`);
    failed++;
    continue;
  }

  if (dryRun) {
    console.log(`✓ (${content.items.length} items, dry-run)`);
    generated++;
    continue;
  }

  const { error } = await sb.from("lessons").insert({
    language: spec.language,
    level: entry.level,
    topic: entry.topic,
    lesson_number: entry.lesson_number,
    title: entry.title,
    content,
  });
  if (error) {
    console.log(`✗ db: ${error.message}`);
    failed++;
    continue;
  }
  console.log(`✓ (${content.items.length} items)`);
  generated++;
}

console.log(
  `\n[curriculum] done. generated=${generated} skipped=${skipped} failed=${failed}`,
);
