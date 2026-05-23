// Shared utilities for quiz/test handlers — distractor generation,
// fuzzy Spanish matching, MCQ option helpers. Used by:
//   - lib/handlers/quiz.ts (single-question "quiz me" pop quiz)
//   - lib/handlers/module-quiz.ts (end-of-module checkpoint)
//   - lib/handlers/lesson-quiz.ts (end-of-lesson quiz)
//
// Keeping this in one place so the three quiz systems behave
// consistently (same distractor style, same speaking grading rules,
// same option-id format).

import { chatCompletion } from "@/lib/messaging/openai";
import type { LessonItem } from "@/types";

// Distractor mode controls which side of the Spanish/English bridge
// we ask GPT to invent wrong answers for:
//   - recognition: student sees Spanish, picks English → wrong English meanings
//   - production:  student sees English, picks Spanish → wrong Spanish words
export type DistractorMode = "recognition" | "production";

// Generate plausible wrong answers for every item in a batch via a
// single GPT call. Returns one inner array per input item (in the
// same order), each containing `n` distractors. Always returns
// exactly `items.length` arrays — padding with safe fallbacks if
// GPT under-delivers — so callers can index by item position.
export async function generateDistractorsBatch(
  items: LessonItem[],
  mode: DistractorMode = "recognition",
  n: number = 2,
): Promise<string[][]> {
  const sourceLang = mode === "recognition" ? "Spanish" : "English";
  const targetLang = mode === "recognition" ? "English" : "Spanish";
  const charCap = mode === "recognition" ? 18 : 24; // Spanish words are longer

  const system =
    `You generate plausible-but-wrong ${targetLang} options for a Spanish-language quiz. ` +
    `Output JSON shaped {"sets":[["d1","d2"],["d1","d2"],...]} — one inner array of ${n} distractors per input item, in the same order. ` +
    `Each distractor ≤${charCap} chars. They must be tempting but clearly wrong to a learner who knows the right answer. ` +
    `Preserve accents. No quotes inside the strings.`;

  const lines = items
    .map((it, i) => {
      const source =
        mode === "recognition" ? it.target_language : it.native_language;
      const correct =
        mode === "recognition" ? it.native_language : it.target_language;
      return `${i + 1}. ${sourceLang}: "${source}" — correct ${targetLang}: "${correct}"`;
    })
    .join("\n");
  const user = `Generate ${n} wrong ${targetLang} options per item:\n\n${lines}\n\nReturn JSON only.`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      temperature: 0.7,
      max_tokens: 80 + items.length * 30,
      response_format: { type: "json_object" },
    },
  );
  const parsed = JSON.parse(raw) as { sets?: string[][] };
  const fallback = mode === "recognition" ? "other meaning" : "otra opción";
  const sets = (parsed.sets ?? []).map((arr) =>
    (arr ?? [])
      .map((s) => String(s).slice(0, charCap).trim())
      .filter((s) => s.length > 0),
  );
  // Pad to the expected length so the caller's mapping never undefs.
  while (sets.length < items.length) {
    sets.push(new Array(n).fill(fallback));
  }
  // Backfill missing distractors within a set if GPT under-delivered.
  return sets.map((s) => {
    const filled = s.slice(0, n);
    while (filled.length < n) filled.push(fallback);
    return filled;
  });
}

// Normalize Spanish for forgiving speaking-grading. Strips accents,
// lowercases, removes punctuation. "Hola, ¿qué tal?" → "hola que tal"
export function normalizeSpanish(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[¿?¡!.,:;"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Forgiving fuzzy match for voice-note quiz answers. Returns true if
// the student's transcription is close enough to the expected target.
// Tolerates leading articles ("El agua" ↔ "agua") and partial captures
// when ≥70% of expected tokens land in the transcription.
export function fuzzyMatchSpanish(
  transcription: string,
  expected: string,
): boolean {
  const t = normalizeSpanish(transcription);
  const e = normalizeSpanish(expected);
  if (!t || !e) return false;
  if (t === e) return true;
  if (t.includes(e)) return true;
  if (e.includes(t) && t.length >= Math.max(3, e.length * 0.6)) return true;
  const eTokens = e.split(" ");
  const tTokens = new Set(t.split(" "));
  const hits = eTokens.filter((tok) => tTokens.has(tok)).length;
  return hits / eTokens.length >= 0.7;
}

// Trim a string to fit WhatsApp's button-title cap (20 chars max in
// Meta's API; we cap at 18 for headroom). Returns a single-… ellipsis
// instead of truncating mid-word when possible.
export function trimTitle(s: string, max: number = 18): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Trim for WhatsApp list-message row titles (24 char cap per Meta).
export function trimListTitle(s: string): string {
  return trimTitle(s, 24);
}

// Short random id for tagging MCQ options. Used in button/list
// reply payloads to identify which option the student picked.
export function rid(): string {
  return Math.random().toString(36).slice(2, 8);
}

// In-place Fisher-Yates shuffle.
export function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
