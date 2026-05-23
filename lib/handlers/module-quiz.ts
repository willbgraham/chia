// End-of-module checkpoint quizzes — Reading, Listening, Speaking.
//
// Triggered automatically by free-chat.ts after a student says
// "next lesson" and advanceCurriculum() detects the just-finished
// lesson was the last one in its module. Manual triggers
// ("module quiz", "listening quiz", "speaking quiz") also enter
// this flow directly.
//
// Flow:
//   1. checkModuleCompletion(userId) → which module (if any) was
//      just finished + hasn't been quiz-prompted yet
//   2. offerCheckpointQuiz() → 3-button prompt (Reading / Listening
//      / Speaking) + state → awaiting_module_quiz
//   3. Button tap → handleQuizChoice() picks 3 LessonItems from the
//      module, generates distractors, sends the first question
//   4. Per-question:
//      - Reading: text prompt + 3 English buttons
//      - Listening: TTS audio of the Spanish + 3 English buttons
//      - Speaking: English prompt → user records voice → Whisper
//        transcribes + fuzzy-matches against the expected Spanish
//   5. After NUM_QUESTIONS, send the score + a celebration if ≥70%
//      and record the module in memory.completed_module_quizzes so
//      we don't re-prompt this module.
//
// Plan-gating: Listening + Speaking are premium-only (they consume
// audio quota / Whisper minutes). Free students tapping those see an
// upgrade nudge and the quiz aborts cleanly.

import {
  sendText,
  sendAudio,
  sendInteractiveButtons,
  fetchMediaUrl,
  downloadMedia,
} from "@/lib/messaging/whatsapp";
import { chatCompletion, transcribeAudio } from "@/lib/messaging/openai";
import { getOrCreateAudio } from "@/lib/messaging/audio-cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { logMessage } from "@/lib/handlers/messages";
import { logAudioUsage, isWithinLimit } from "@/lib/handlers/usage";
import { getModulesForLevel } from "@/lib/handlers/curriculum";
import type { LessonContent, LessonItem, MemoryJson, Plan } from "@/types";

// 3 questions per quiz — long enough to feel like a real checkpoint,
// short enough that students actually finish it on the phone.
const NUM_QUESTIONS = 3;
// Pass threshold for the "🎉 you nailed it" message.
const PASS_FRACTION = 0.67; // 2/3 — forgiving but not trivial

export type ModuleQuizType = "reading" | "listening" | "speaking";

interface QuizQuestion {
  // The Spanish phrase being tested.
  target: string;
  // The English meaning.
  native: string;
  // Two distractor options. For Reading/Listening these are English;
  // unused for Speaking (we don't show options — student speaks).
  distractors: string[];
}

export interface PendingModuleQuiz {
  module_key: string;       // "advanced::5" — what gets stored after pass
  module_idx: number;
  module_name: string;
  level: string;
  // Phase 1: choosing a type. Phase 2: in-progress quiz.
  phase: "choosing" | "running";
  type?: ModuleQuizType;
  questions?: QuizQuestion[];
  question_idx?: number;    // 0-based
  score?: number;
  // Per-question state stamped when each question is sent:
  correct_id?: string;      // button id of correct answer
  options_shuffled?: { id: string; title: string }[]; // remembered for text-fallback grading
}

// ── Module-completion detection ───────────────────────────────────

// Returns module info if the user has completed all lessons in some
// module they haven't been quiz-prompted on. Pick the lowest-index
// such module so quizzes fire in pedagogical order.
export async function checkModuleCompletion(
  userId: string,
): Promise<{ moduleIdx: number; moduleName: string; level: string } | null> {
  const memory = await getMemory(userId);
  const level = memory.level ?? "beginner";
  const alreadyQuizzed = new Set(
    (memory as { completed_module_quizzes?: string[] }).completed_module_quizzes ?? [],
  );

  const sb = getAdminClient();
  const modules = getModulesForLevel(level);
  if (modules.length === 0) return null;

  const { data: allLessons } = await sb
    .from("lessons")
    .select("topic")
    .eq("language", "Spanish")
    .eq("level", level);
  const totalByTopic = new Map<string, number>();
  for (const l of (allLessons ?? []) as { topic: string }[]) {
    totalByTopic.set(l.topic, (totalByTopic.get(l.topic) ?? 0) + 1);
  }

  const { data: completed } = await sb
    .from("user_lesson_progress")
    .select("lesson_id, lessons!inner(topic, level, language)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .eq("lessons.language", "Spanish")
    .eq("lessons.level", level);
  const completedByTopic = new Map<string, number>();
  for (const c of (completed ?? []) as unknown as Array<{
    lessons: { topic: string } | { topic: string }[];
  }>) {
    // supabase-js types joined relations as arrays even when it's a
    // single row at runtime — handle both shapes.
    const rel = c.lessons;
    const topic = Array.isArray(rel) ? rel[0]?.topic : rel?.topic;
    if (!topic) continue;
    completedByTopic.set(topic, (completedByTopic.get(topic) ?? 0) + 1);
  }

  for (let i = 0; i < modules.length; i++) {
    const key = `${level}::${i}`;
    if (alreadyQuizzed.has(key)) continue;
    const m = modules[i];
    let total = 0;
    let done = 0;
    for (const topic of m.topics) {
      total += totalByTopic.get(topic) ?? 0;
      done += completedByTopic.get(topic) ?? 0;
    }
    if (total > 0 && done >= total) {
      return { moduleIdx: i, moduleName: m.name, level };
    }
  }
  return null;
}

// ── Phase 1: Offer the quiz ───────────────────────────────────────

export async function offerCheckpointQuiz(args: {
  userId: string;
  whatsappNumber: string;
  moduleIdx: number;
  moduleName: string;
  level: string;
}): Promise<void> {
  const pending: PendingModuleQuiz = {
    module_key: `${args.level}::${args.moduleIdx}`,
    module_idx: args.moduleIdx,
    module_name: args.moduleName,
    level: args.level,
    phase: "choosing",
  };
  await patchMemory(args.userId, {
    pending_module_quiz: pending,
  } as Partial<MemoryJson>);
  await updateState(args.userId, { state: "awaiting_module_quiz" });

  const body =
    `🎉 ¡Has terminado *${args.moduleName}*!\n\n` +
    `Want to test what you learned? Pick a quiz — or reply *skip* to keep moving.`;

  const buttons = [
    { id: "mq_reading", title: "📖 Reading" },
    { id: "mq_listening", title: "🎧 Listening" },
    { id: "mq_speaking", title: "🎤 Speaking" },
  ];

  const result = await sendInteractiveButtons(args.whatsappNumber, body, buttons);
  if (result.error) {
    // Fallback: text prompt with numeric replies.
    await sendText(
      args.whatsappNumber,
      `${body}\n\n1. Reading\n2. Listening\n3. Speaking\n\n(reply 1, 2, 3, or *skip*)`,
    );
  }

  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[module quiz offered] ${args.moduleName}`,
  });
}

// ── Phase 2: User picked a type ───────────────────────────────────

export async function handleQuizChoice(args: {
  userId: string;
  whatsappNumber: string;
  choice: ModuleQuizType | "skip";
  userPlan: Plan;
  billingPeriodStart: string | null;
}): Promise<void> {
  const memory = await getMemory(args.userId);
  const pending = (memory as { pending_module_quiz?: PendingModuleQuiz })
    .pending_module_quiz;
  if (!pending) {
    await sendText(
      args.whatsappNumber,
      "I lost track of the quiz 🌿 Tell me *next lesson* to keep moving.",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  if (args.choice === "skip") {
    await endQuiz(args.userId, "skipped");
    await sendText(
      args.whatsappNumber,
      "Sin problema 🌿 Tell me *next lesson* whenever you're ready.",
    );
    return;
  }

  // Plan-gate audio quizzes.
  if (
    (args.choice === "listening" || args.choice === "speaking") &&
    args.userPlan !== "premium"
  ) {
    await sendText(
      args.whatsappNumber,
      `🎧 The ${args.choice} quiz uses my voice and Whisper transcription — that's a premium feature. Type *upgrade* to unlock voice quizzes, or pick the reading quiz instead (just tap *📖 Reading*).`,
    );
    // Leave the quiz in choosing state so they can pick reading.
    return;
  }

  // Build questions from the module's lesson content.
  let questions: QuizQuestion[];
  try {
    questions = await buildQuestions({
      level: pending.level,
      moduleIdx: pending.module_idx,
    });
  } catch (err) {
    console.error("[module-quiz] buildQuestions failed:", err);
    await sendText(
      args.whatsappNumber,
      "Quiz generator is napping 🌿 Tell me *next lesson* to skip it.",
    );
    return;
  }
  if (questions.length === 0) {
    await sendText(
      args.whatsappNumber,
      "I don't have enough quiz-worthy material in this module 🌿 Tell me *next lesson*.",
    );
    await endQuiz(args.userId, "empty");
    return;
  }

  const updated: PendingModuleQuiz = {
    ...pending,
    phase: "running",
    type: args.choice,
    questions,
    question_idx: 0,
    score: 0,
  };
  await patchMemory(args.userId, {
    pending_module_quiz: updated,
  } as Partial<MemoryJson>);

  await sendText(
    args.whatsappNumber,
    `Vale 🌿 ${args.choice === "reading" ? "Reading" : args.choice === "listening" ? "Listening" : "Speaking"} quiz — ${NUM_QUESTIONS} questions. Vamos.`,
  );

  await sendNextQuestion({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz: updated,
    userPlan: args.userPlan,
    billingPeriodStart: args.billingPeriodStart,
  });
}

// ── Phase 3: Grading answers ──────────────────────────────────────

// Inbound: button tap or text fallback for Reading / Listening.
export async function handleQuizAnswer(args: {
  userId: string;
  whatsappNumber: string;
  buttonReplyId: string | null;
  textFallback: string | null;
  userPlan: Plan;
  billingPeriodStart: string | null;
}): Promise<void> {
  const memory = await getMemory(args.userId);
  const quiz = (memory as { pending_module_quiz?: PendingModuleQuiz })
    .pending_module_quiz;
  if (!quiz || quiz.phase !== "running" || !quiz.questions) {
    // Maybe they're replying to the choice prompt with text:
    if (quiz?.phase === "choosing" && args.textFallback) {
      const choice = parseChoiceText(args.textFallback);
      if (choice) {
        await handleQuizChoice({
          userId: args.userId,
          whatsappNumber: args.whatsappNumber,
          choice,
          userPlan: args.userPlan,
          billingPeriodStart: args.billingPeriodStart,
        });
        return;
      }
    }
    await sendText(
      args.whatsappNumber,
      "I lost the quiz thread 🌿 Tell me *next lesson* to continue.",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  // Speaking shouldn't be answered with a button — but if it is, treat
  // as if they tried to skip the question.
  if (quiz.type === "speaking") {
    await sendText(
      args.whatsappNumber,
      "For the speaking quiz, send a voice note saying it in Spanish 🎤",
    );
    return;
  }

  // Resolve which option they picked.
  let pickedId = args.buttonReplyId;
  if (!pickedId && args.textFallback && quiz.options_shuffled) {
    const m = args.textFallback.trim().match(/^([123])\b/);
    if (m) {
      const idx = Number.parseInt(m[1], 10) - 1;
      pickedId = quiz.options_shuffled[idx]?.id ?? null;
    }
  }
  const correct = pickedId === quiz.correct_id;
  await sendGradeAndAdvance({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz,
    correct,
    actualLine: correct ? null : currentQuestion(quiz).native,
    userPlan: args.userPlan,
    billingPeriodStart: args.billingPeriodStart,
  });
}

// Inbound: voice note for Speaking quiz.
export async function handleQuizVoice(args: {
  userId: string;
  whatsappNumber: string;
  audioMediaId: string;
  userPlan: Plan;
  billingPeriodStart: string | null;
}): Promise<void> {
  const memory = await getMemory(args.userId);
  const quiz = (memory as { pending_module_quiz?: PendingModuleQuiz })
    .pending_module_quiz;
  if (!quiz || quiz.phase !== "running" || quiz.type !== "speaking") {
    await sendText(
      args.whatsappNumber,
      "I wasn't expecting a voice note for the quiz 🌿 Tell me *next lesson* to continue.",
    );
    return;
  }

  const mediaUrl = await fetchMediaUrl(args.audioMediaId);
  if (!mediaUrl) {
    await sendText(
      args.whatsappNumber,
      "Couldn't grab your voice note — try sending it again?",
    );
    return;
  }
  const audio = await downloadMedia(mediaUrl);

  let transcription = "";
  try {
    transcription = await transcribeAudio(audio, { language: "es" });
  } catch (err) {
    console.error("[module-quiz] whisper failed:", err);
    await sendText(
      args.whatsappNumber,
      "I couldn't quite hear that 🌿 Try once more?",
    );
    return;
  }

  const expected = currentQuestion(quiz).target;
  const correct = fuzzyMatchSpanish(transcription, expected);

  await sendGradeAndAdvance({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz,
    correct,
    actualLine: correct ? null : `${expected} (you said: "${transcription.trim()}")`,
    userPlan: args.userPlan,
    billingPeriodStart: args.billingPeriodStart,
  });
}

// ── Internals ─────────────────────────────────────────────────────

function currentQuestion(quiz: PendingModuleQuiz): QuizQuestion {
  return quiz.questions![quiz.question_idx ?? 0];
}

// Grade the answer just received, persist score, send feedback, then
// send the next question (or finish the quiz).
async function sendGradeAndAdvance(args: {
  userId: string;
  whatsappNumber: string;
  quiz: PendingModuleQuiz;
  correct: boolean;
  actualLine: string | null; // null = correct
  userPlan: Plan;
  billingPeriodStart: string | null;
}): Promise<void> {
  const { quiz } = args;
  const newScore = (quiz.score ?? 0) + (args.correct ? 1 : 0);
  const newIdx = (quiz.question_idx ?? 0) + 1;

  const feedback = args.correct
    ? `¡Sí! 🌿 (${newScore}/${newIdx})`
    : `Casi — la respuesta era *${args.actualLine}* 🌿 (${newScore}/${newIdx})`;
  await sendText(args.whatsappNumber, feedback);

  if (newIdx >= quiz.questions!.length) {
    await finishQuiz({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      quiz: { ...quiz, score: newScore, question_idx: newIdx },
    });
    return;
  }

  const updated: PendingModuleQuiz = {
    ...quiz,
    question_idx: newIdx,
    score: newScore,
    correct_id: undefined,
    options_shuffled: undefined,
  };
  await patchMemory(args.userId, {
    pending_module_quiz: updated,
  } as Partial<MemoryJson>);

  await sendNextQuestion({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz: updated,
    userPlan: args.userPlan,
    billingPeriodStart: args.billingPeriodStart,
  });
}

// Send the prompt for whatever question_idx points at.
async function sendNextQuestion(args: {
  userId: string;
  whatsappNumber: string;
  quiz: PendingModuleQuiz;
  userPlan: Plan;
  billingPeriodStart: string | null;
}): Promise<void> {
  const q = currentQuestion(args.quiz);
  const qNum = (args.quiz.question_idx ?? 0) + 1;
  const total = args.quiz.questions!.length;

  if (args.quiz.type === "speaking") {
    // English prompt + ask for a voice note. No buttons.
    await sendText(
      args.whatsappNumber,
      `Pregunta ${qNum}/${total} 🎤\n\nHow do you say *"${q.native}"* in Spanish?\n\nSend me a voice note with the answer.`,
    );
    return;
  }

  // Reading and Listening: 3-button MCQ. Build the shuffled options
  // with a fresh correct_id and stash them in memory for fallback grading.
  const correctId = `c_${rid()}`;
  const options = [
    { id: correctId, title: trimTitle(q.native) },
    { id: `d1_${rid()}`, title: trimTitle(q.distractors[0]) },
    { id: `d2_${rid()}`, title: trimTitle(q.distractors[1]) },
  ];
  shuffle(options);

  const updated: PendingModuleQuiz = {
    ...args.quiz,
    correct_id: correctId,
    options_shuffled: options,
  };
  await patchMemory(args.userId, {
    pending_module_quiz: updated,
  } as Partial<MemoryJson>);

  // Listening: send audio first, then the buttons.
  if (args.quiz.type === "listening") {
    // Quota check — premium has a per-period cap. If they're over,
    // degrade to text-only listening (show the Spanish phrase).
    const within = args.billingPeriodStart
      ? await isWithinLimit(
          args.userId,
          args.userPlan,
          args.billingPeriodStart,
          q.target.length,
        )
      : true;
    if (within) {
      try {
        const { publicUrl, charactersGenerated } = await getOrCreateAudio(
          q.target,
        );
        if (charactersGenerated > 0) {
          await logAudioUsage({
            user_id: args.userId,
            characters_used: charactersGenerated,
            source: "make_tts",
            direction: "outbound",
          });
        }
        await sendAudio(args.whatsappNumber, publicUrl);
      } catch (err) {
        console.error("[module-quiz] tts failed:", err);
        // Fall through to text-only so the quiz keeps moving.
        await sendText(args.whatsappNumber, `🎧 (audio glitched) Spanish: "${q.target}"`);
      }
    } else {
      // Over quota — degrade gracefully.
      await sendText(args.whatsappNumber, `🎧 (over voice quota this period) Spanish: "${q.target}"`);
    }
  }

  const promptBody =
    args.quiz.type === "listening"
      ? `Pregunta ${qNum}/${total} 🎧\n\nWhat did I just say?`
      : `Pregunta ${qNum}/${total} 📖\n\nWhat does *"${q.target}"* mean?`;

  const result = await sendInteractiveButtons(
    args.whatsappNumber,
    promptBody,
    options,
  );
  if (result.error) {
    await sendText(
      args.whatsappNumber,
      `${promptBody}\n\n1. ${options[0].title}\n2. ${options[1].title}\n3. ${options[2].title}\n\n(reply 1, 2, or 3)`,
    );
  }

  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[module-quiz ${args.quiz.type}] q${qNum}/${total}: ${q.target} ↔ ${q.native}`,
  });
}

async function finishQuiz(args: {
  userId: string;
  whatsappNumber: string;
  quiz: PendingModuleQuiz;
}): Promise<void> {
  const score = args.quiz.score ?? 0;
  const total = args.quiz.questions!.length;
  const fraction = score / total;
  const passed = fraction >= PASS_FRACTION;

  const head = passed
    ? `🎉 ¡Bien hecho! ${score}/${total} — you've earned the *${args.quiz.module_name}* badge.`
    : `🌿 ${score}/${total} — not bad. Want to redo this quiz later? Just type *module quiz*.`;
  const tail = `\n\nReady for the next module? Tell me *next lesson*.`;
  await sendText(args.whatsappNumber, head + tail);

  await endQuiz(args.userId, passed ? "passed" : "failed", args.quiz);
}

async function endQuiz(
  userId: string,
  status: "passed" | "failed" | "skipped" | "empty",
  quiz?: PendingModuleQuiz,
): Promise<void> {
  const memory = await getMemory(userId);
  const completed = new Set(
    (memory as { completed_module_quizzes?: string[] }).completed_module_quizzes ?? [],
  );
  // Record the module so we don't re-prompt — even on skip/empty/fail
  // (failure can be retried via manual "module quiz" trigger later).
  if (quiz?.module_key) completed.add(quiz.module_key);
  else {
    // If we don't have the quiz arg, pull module_key from current pending.
    const cur = (memory as { pending_module_quiz?: PendingModuleQuiz }).pending_module_quiz;
    if (cur?.module_key) completed.add(cur.module_key);
  }

  await patchMemory(userId, {
    pending_module_quiz: undefined,
    completed_module_quizzes: Array.from(completed),
  } as Partial<MemoryJson>);
  await updateState(userId, { state: "active_free_chat" });
  void status;
}

// Pick NUM_QUESTIONS items from the module's lessons. Items must have
// target + native, both short enough for button titles. Generate 2
// distractors per item via GPT (single batched call for the whole quiz
// to keep latency reasonable).
async function buildQuestions(args: {
  level: string;
  moduleIdx: number;
}): Promise<QuizQuestion[]> {
  const sb = getAdminClient();
  const modules = getModulesForLevel(args.level);
  const mod = modules[args.moduleIdx];
  if (!mod) return [];

  const { data: lessons } = await sb
    .from("lessons")
    .select("topic, content")
    .eq("language", "Spanish")
    .eq("level", args.level)
    .in("topic", mod.topics);

  // Flatten + filter all suitable items.
  const items: LessonItem[] = [];
  for (const l of (lessons ?? []) as { content: LessonContent }[]) {
    for (const item of l.content?.items ?? []) {
      if (
        (item.type === "vocabulary" || item.type === "phrase") &&
        item.target_language &&
        item.native_language &&
        item.target_language.length <= 30 &&
        item.native_language.length <= 18
      ) {
        items.push(item);
      }
    }
  }
  if (items.length === 0) return [];

  // Pick NUM_QUESTIONS unique items.
  shuffle(items);
  const picked = items.slice(0, NUM_QUESTIONS);

  // Generate distractors for all picked items in one GPT call.
  let distractorSets: string[][];
  try {
    distractorSets = await generateDistractorsBatch(picked);
  } catch (err) {
    console.error("[module-quiz] distractor batch failed:", err);
    // Fall back to generic distractors so quiz still ships.
    distractorSets = picked.map(() => ["other meaning", "no idea"]);
  }

  return picked.map((it, i) => ({
    target: it.target_language,
    native: it.native_language,
    distractors: distractorSets[i] ?? ["other meaning", "no idea"],
  }));
}

async function generateDistractorsBatch(
  items: LessonItem[],
): Promise<string[][]> {
  const system = `You generate plausible-but-wrong English meanings for a Spanish quiz. Output JSON shaped {"sets":[["d1","d2"],["d1","d2"],...]} — one inner array of 2 distractors per input item, in the same order. Each distractor ≤18 chars. They must be tempting but clearly wrong to a learner who knows the right answer. No accents missing. No quotes inside the strings.`;
  const lines = items
    .map(
      (it, i) =>
        `${i + 1}. Spanish: "${it.target_language}" — correct English: "${it.native_language}"`,
    )
    .join("\n");
  const user = `Generate 2 wrong English meanings per item:\n\n${lines}\n\nReturn JSON only.`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      temperature: 0.7,
      max_tokens: 400,
      response_format: { type: "json_object" },
    },
  );
  const parsed = JSON.parse(raw) as { sets?: string[][] };
  const sets = (parsed.sets ?? []).map((arr) =>
    (arr ?? [])
      .map((s) => String(s).slice(0, 18).trim())
      .filter((s) => s.length > 0),
  );
  // Pad to the expected length so the caller's mapping never undefs.
  while (sets.length < items.length) sets.push(["other meaning", "no idea"]);
  return sets;
}

// Normalize Spanish for forgiving Speaking grading. Strips accents,
// lowercases, removes punctuation. "Hola, ¿qué tal?" → "hola que tal"
function normalizeSpanish(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[¿?¡!.,:;"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyMatchSpanish(transcription: string, expected: string): boolean {
  const t = normalizeSpanish(transcription);
  const e = normalizeSpanish(expected);
  if (!t || !e) return false;
  // Forgiving: either contains the other (handles "El agua" vs "agua").
  if (t === e) return true;
  if (t.includes(e)) return true;
  if (e.includes(t) && t.length >= Math.max(3, e.length * 0.6)) return true;
  // Token-overlap fallback: ≥70% of expected tokens appear in transcription.
  const eTokens = e.split(" ");
  const tTokens = new Set(t.split(" "));
  const hits = eTokens.filter((tok) => tTokens.has(tok)).length;
  return hits / eTokens.length >= 0.7;
}

// Map a button id or numeric text reply to a quiz-type choice.
export function parseChoiceFromButtonId(id: string | null | undefined):
  | ModuleQuizType
  | "skip"
  | null {
  if (!id) return null;
  if (id === "mq_reading") return "reading";
  if (id === "mq_listening") return "listening";
  if (id === "mq_speaking") return "speaking";
  return null;
}

export function parseChoiceText(text: string): ModuleQuizType | "skip" | null {
  const t = text.trim().toLowerCase();
  if (/^(skip|saltar|no|paso)\b/.test(t)) return "skip";
  if (/^1\b|reading|lectura|read\b/.test(t)) return "reading";
  if (/^2\b|listening|escucha|hear\b/.test(t)) return "listening";
  if (/^3\b|speaking|habla|hablar|speak\b/.test(t)) return "speaking";
  return null;
}

function trimTitle(s: string): string {
  return s.length <= 18 ? s : s.slice(0, 17) + "…";
}

function rid(): string {
  return Math.random().toString(36).slice(2, 8);
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
