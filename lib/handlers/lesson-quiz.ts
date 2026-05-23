// End-of-lesson interactive loop: guided practice + multi-question quiz.
//
// Replaces the old "lesson text + audio → active_free_chat" finale
// with a proper pedagogical loop:
//
//   1. startLessonPractice — 2-3 GPT-graded open-response prompts
//      (3 if the lesson has rule/conjugation items; 2 otherwise)
//   2. After last practice → startLessonQuiz — 5 MCQs covering ALL
//      the lesson's items (mix of recognition + production; premium
//      gets 1 speaking question replaced in)
//   3. After last quiz question → write per-item results into
//      memory.language_progress.{strong_points, repeated_mistakes},
//      call markLessonComplete, then checkModuleCompletion → if a
//      module just ended, offer the checkpoint quiz; else send the
//      "tell me next lesson" close.
//
// Mastery is soft-gated: <70% records the items in repeated_mistakes
// (for Phase 2 spaced review) but the lesson still marks complete and
// the student advances. Hard gating on a phone is too punishing.
//
// Quit semantics: `skip` / `quit` / `pause` / `dejar` / `saltar`
// → state cleared, lesson NOT marked complete, returns to free chat.
// Student can resume by typing "next lesson" — they re-receive the
// same lesson since the row is still in_progress (not completed).

import {
  sendText,
  sendInteractiveButtons,
  sendInteractiveList,
  fetchMediaUrl,
  downloadMedia,
} from "@/lib/messaging/whatsapp";
import { chatCompletion, transcribeAudio } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { logMessage } from "@/lib/handlers/messages";
import { markLessonComplete } from "@/lib/handlers/lesson";
import {
  checkModuleCompletion,
  offerCheckpointQuiz,
} from "@/lib/handlers/module-quiz";
import {
  generateDistractorsBatch,
  fuzzyMatchSpanish,
  trimTitle,
  trimListTitle,
  rid,
  shuffle,
} from "@/lib/handlers/quiz-shared";
import type {
  Lesson,
  LessonItem,
  MemoryJson,
  Plan,
} from "@/types";

// ── Tunables ──────────────────────────────────────────────────────

const QUIZ_QUESTIONS = 5;
const PASS_FRACTION = 0.7;
const SPEAKING_QUESTIONS_PREMIUM = 1; // 1 of the 5 questions is voice for premium

// Practice prompts per lesson — more for grammar-heavy lessons so
// students get to manipulate the rule, fewer for vocab-heavy.
const PRACTICE_VOCAB = 2;
const PRACTICE_GRAMMAR = 3;

// ── Types ─────────────────────────────────────────────────────────

export interface PendingLessonPractice {
  lesson_id: string;
  lesson_topic: string;
  lesson_number: number;
  lesson_title: string;
  prompts: string[];
  idx: number;
  // Snapshot of lesson items so the quiz step doesn't need to refetch
  // the lesson row. Keeps memory writes local to this state machine.
  items_snapshot: LessonItem[];
}

export type QuizMode = "recognition" | "production" | "speaking";

export interface LessonQuizQuestion {
  // The Spanish target being tested.
  target: string;
  // The English meaning.
  native: string;
  mode: QuizMode;
  // For MCQ modes: 2-6 wrong options matching the mode's language.
  // Empty for speaking (student records a voice note instead).
  distractors: string[];
}

export interface PendingLessonQuiz {
  lesson_id: string;
  lesson_topic: string;
  lesson_number: number;
  lesson_title: string;
  questions: LessonQuizQuestion[];
  idx: number;
  score: number;
  // Per-question state stamped when each question is sent. Cleared
  // and re-stamped on advance.
  correct_id?: string;
  options_shuffled?: { id: string; title: string }[];
  // Accumulated per-item grading for end-of-quiz writeback to
  // memory.language_progress.
  per_item_results: { target: string; native: string; correct: boolean }[];
}

// ── Phase 1: practice ─────────────────────────────────────────────

interface StartPracticeArgs {
  userId: string;
  whatsappNumber: string;
  lesson: Lesson;
  teacherId: string | null;
  userPlan: Plan;
}

// Pick prompts from lesson.content.practice_prompts (authored by the
// GPT curriculum generator). If a lesson has no prompts (legacy
// content) or only one, we skip the practice phase entirely and go
// straight to the quiz so the student isn't stuck.
export async function startLessonPractice(
  args: StartPracticeArgs,
): Promise<void> {
  const allPrompts = (args.lesson.content.practice_prompts ?? []).filter(
    (p) => typeof p === "string" && p.trim().length > 0,
  );

  const hasGrammar = (args.lesson.content.items ?? []).some(
    (it) => it.type === "rule" || it.type === "conjugation",
  );
  const want = hasGrammar ? PRACTICE_GRAMMAR : PRACTICE_VOCAB;
  const prompts = allPrompts.slice(0, want);

  if (prompts.length < 2) {
    // No useful practice prompts authored — skip straight to quiz.
    await startLessonQuiz(args);
    return;
  }

  const pending: PendingLessonPractice = {
    lesson_id: args.lesson.id,
    lesson_topic: args.lesson.topic,
    lesson_number: args.lesson.lesson_number,
    lesson_title: args.lesson.title,
    prompts,
    idx: 0,
    items_snapshot: args.lesson.content.items ?? [],
  };

  await patchMemory(args.userId, {
    pending_lesson_practice: pending,
    pending_lesson_quiz: undefined,
  } as Partial<MemoryJson>);
  await updateState(args.userId, { state: "awaiting_lesson_practice" });

  // Bridge message + first prompt. Single send for tight pacing.
  await sendText(
    args.whatsappNumber,
    `Now let's practice 🌿\n\n*Práctica 1/${prompts.length}*\n${prompts[0]}\n\n_Reply in any mix of Spanish + English — I'll give you feedback. Type *skip* to jump to the quiz._`,
  );
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[lesson practice 1/${prompts.length}] ${prompts[0]}`,
  });
}

interface HandlePracticeArgs {
  userId: string;
  whatsappNumber: string;
  userMessage: string;
  teacherId: string | null;
  userPlan: Plan;
}

export async function handlePracticeResponse(
  args: HandlePracticeArgs,
): Promise<void> {
  // Quit intent always wins before grading.
  if (matchQuitIntent(args.userMessage)) {
    await handleQuitIntent(args.userId, args.whatsappNumber);
    return;
  }

  const memory = await getMemory(args.userId);
  const pending = (memory as { pending_lesson_practice?: PendingLessonPractice })
    .pending_lesson_practice;
  if (!pending) {
    // Lost state — recover gracefully.
    await sendText(
      args.whatsappNumber,
      "🌿 Looks like we got interrupted. Tell me *next lesson* to keep moving.",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  // Single short GPT call: warm feedback in Chia's teacher voice.
  // Kept terse so practice momentum stays high (1 sentence target).
  let feedback = "";
  try {
    feedback = await gradePracticeResponse({
      prompt: pending.prompts[pending.idx],
      response: args.userMessage,
      lessonTitle: pending.lesson_title,
      items: pending.items_snapshot,
    });
  } catch (err) {
    console.error("[lesson-quiz] practice grading failed:", err);
    feedback = "Buen intento 🌿"; // Soft fallback — don't break flow.
  }

  await sendText(args.whatsappNumber, feedback);
  await logMessage({
    userId: args.userId,
    role: "user",
    content: `[lesson practice ${pending.idx + 1}/${pending.prompts.length}] ${args.userMessage}`,
  });
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: feedback,
  });

  const nextIdx = pending.idx + 1;
  if (nextIdx >= pending.prompts.length) {
    // Practice exhausted → start the quiz. Reconstruct a minimal
    // Lesson-shape from the snapshot so we don't refetch.
    await startLessonQuiz({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      lesson: {
        id: pending.lesson_id,
        topic: pending.lesson_topic,
        lesson_number: pending.lesson_number,
        title: pending.lesson_title,
        language: "Spanish",
        // level + content are partially synthetic here — we only use
        // .content.items downstream. The minimal shape keeps tsc happy
        // without forcing a refetch.
        level: "",
        content: {
          introduction: "",
          items: pending.items_snapshot,
          summary: "",
          practice_prompts: [],
        },
        created_at: "",
      },
      teacherId: args.teacherId,
      userPlan: args.userPlan,
    });
    return;
  }

  const updated: PendingLessonPractice = { ...pending, idx: nextIdx };
  await patchMemory(args.userId, {
    pending_lesson_practice: updated,
  } as Partial<MemoryJson>);

  await sendText(
    args.whatsappNumber,
    `*Práctica ${nextIdx + 1}/${pending.prompts.length}*\n${pending.prompts[nextIdx]}`,
  );
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[lesson practice ${nextIdx + 1}/${pending.prompts.length}] ${pending.prompts[nextIdx]}`,
  });
}

// Short GPT eval. One warm specific sentence + maybe a tiny correction.
// Returns a Chia-voice reply ready to send. Bounded tokens to keep
// the practice loop snappy.
async function gradePracticeResponse(args: {
  prompt: string;
  response: string;
  lessonTitle: string;
  items: LessonItem[];
}): Promise<string> {
  const itemHints = args.items
    .slice(0, 8)
    .map((it) => `${it.target_language} = ${it.native_language}`)
    .join(", ");

  const system =
    `You are Chia, a 27-year-old Spanish teacher from Valencia. The student is practicing a lesson — give one or two short sentences of warm, specific feedback on their response. ` +
    `Acknowledge what they got right. If there's a small correction worth making, deliver it gently in one line. Mix Spanish + English naturally like a friend. End with a tiny encouragement or transition. ` +
    `NO headers, no bullet lists, no "Great job!". Just a couple of natural sentences. Max ~40 words. Don't ask a follow-up question — we're moving to the next prompt.`;

  const user =
    `Lesson: ${args.lessonTitle}\n` +
    `Key vocab/phrases: ${itemHints}\n` +
    `Prompt: ${args.prompt}\n` +
    `Student response: ${args.response}\n\n` +
    `Reply as Chia.`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      model: process.env.CHIA_PERSONALITY_MODEL ?? "gpt-4o-mini",
      temperature: 0.8,
      max_tokens: 120,
    },
  );
  return raw.trim();
}

// ── Phase 2: quiz ─────────────────────────────────────────────────

interface StartQuizArgs {
  userId: string;
  whatsappNumber: string;
  lesson: Lesson;
  teacherId: string | null;
  userPlan: Plan;
}

export async function startLessonQuiz(args: StartQuizArgs): Promise<void> {
  const items = (args.lesson.content.items ?? []).filter(
    (it) =>
      (it.type === "vocabulary" || it.type === "phrase") &&
      it.target_language &&
      it.native_language &&
      it.target_language.length <= 30 &&
      it.native_language.length <= 30,
  );

  if (items.length < 2) {
    // Not enough quiz-able items — congratulate and close out.
    await sendText(
      args.whatsappNumber,
      `🎉 Lesson complete — *${args.lesson.title}*. Tell me *next lesson* when you're ready.`,
    );
    await markLessonComplete(args.userId, args.lesson.id);
    await patchMemory(args.userId, {
      pending_lesson_practice: undefined,
      pending_lesson_quiz: undefined,
    } as Partial<MemoryJson>);
    await updateState(args.userId, { state: "active_free_chat" });
    await maybeOfferModuleCheckpoint(args);
    return;
  }

  // Sample N items (capped by available items) and build the quiz.
  shuffle(items);
  const wantQuestions = Math.min(QUIZ_QUESTIONS, items.length);
  const picked = items.slice(0, wantQuestions);

  // Assign modes — 60% recognition, 40% production, then swap N for
  // speaking if premium. Speaking questions test the student's ability
  // to produce the Spanish target aloud (Whisper grades).
  const modes: QuizMode[] = picked.map((_, i) =>
    i < Math.ceil(picked.length * 0.6) ? "recognition" : "production",
  );
  if (args.userPlan === "premium") {
    const speakingCount = Math.min(SPEAKING_QUESTIONS_PREMIUM, picked.length - 1);
    // Replace the LAST modes with speaking so MCQs land first and
    // students warm up before the open-ended voice question.
    for (let i = 0; i < speakingCount; i++) {
      modes[modes.length - 1 - i] = "speaking";
    }
  }

  // Generate distractors per item per mode. Two GPT calls (one per
  // distractor language) — saves cost vs per-question calls.
  const recognitionIdx = modes
    .map((m, i) => (m === "recognition" ? i : -1))
    .filter((i) => i >= 0);
  const productionIdx = modes
    .map((m, i) => (m === "production" ? i : -1))
    .filter((i) => i >= 0);

  let recogDistractors: string[][] = [];
  let prodDistractors: string[][] = [];

  // 4 options total (1 correct + 3 distractors) for lists; 3 for buttons.
  // We always ask for 3 distractors so we can render as a list — if we
  // need fewer (e.g. degraded to buttons) we'll just use the first 2.
  try {
    if (recognitionIdx.length > 0) {
      recogDistractors = await generateDistractorsBatch(
        recognitionIdx.map((i) => picked[i]),
        "recognition",
        3,
      );
    }
    if (productionIdx.length > 0) {
      prodDistractors = await generateDistractorsBatch(
        productionIdx.map((i) => picked[i]),
        "production",
        3,
      );
    }
  } catch (err) {
    console.error("[lesson-quiz] distractor generation failed:", err);
    // Fall through — fuzzy fallbacks ("other meaning") will be used.
  }

  const questions: LessonQuizQuestion[] = picked.map((item, i) => {
    const mode = modes[i];
    if (mode === "speaking") {
      return {
        target: item.target_language,
        native: item.native_language,
        mode,
        distractors: [],
      };
    }
    const set =
      mode === "recognition"
        ? recogDistractors[recognitionIdx.indexOf(i)] ?? []
        : prodDistractors[productionIdx.indexOf(i)] ?? [];
    return {
      target: item.target_language,
      native: item.native_language,
      mode,
      distractors:
        set.length >= 2
          ? set
          : [
              mode === "recognition" ? "another meaning" : "otra palabra",
              mode === "recognition" ? "no idea" : "no sé",
              mode === "recognition" ? "different one" : "diferente",
            ].slice(0, 3),
    };
  });

  const pending: PendingLessonQuiz = {
    lesson_id: args.lesson.id,
    lesson_topic: args.lesson.topic,
    lesson_number: args.lesson.lesson_number,
    lesson_title: args.lesson.title,
    questions,
    idx: 0,
    score: 0,
    per_item_results: [],
  };
  await patchMemory(args.userId, {
    pending_lesson_practice: undefined,
    pending_lesson_quiz: pending,
  } as Partial<MemoryJson>);
  await updateState(args.userId, { state: "awaiting_lesson_quiz" });

  await sendText(
    args.whatsappNumber,
    `Quiz time 🌿 — ${questions.length} questions on *${args.lesson.title}*. Vamos.`,
  );
  await sendNextLessonQuestion({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz: pending,
  });
}

// Send the prompt for the question at quiz.idx. Decides buttons vs
// list vs voice-prompt based on the mode + option count.
async function sendNextLessonQuestion(args: {
  userId: string;
  whatsappNumber: string;
  quiz: PendingLessonQuiz;
}): Promise<void> {
  const q = args.quiz.questions[args.quiz.idx];
  const qNum = args.quiz.idx + 1;
  const total = args.quiz.questions.length;

  if (q.mode === "speaking") {
    // Speaking question — text prompt, expect a voice note back.
    await sendText(
      args.whatsappNumber,
      `*Pregunta ${qNum}/${total}* 🎤\n\nHow do you say *"${q.native}"* in Spanish?\n\nSend a voice note with your answer.`,
    );
    return;
  }

  // MCQ: target + distractors as options. Recognition shows Spanish
  // and offers English options; production shows English and offers
  // Spanish options.
  const correctText = q.mode === "recognition" ? q.native : q.target;
  const distractors = q.distractors;
  const correctId = `c_${rid()}`;
  const allOptions: { id: string; title: string }[] = [
    { id: correctId, title: trimListTitle(correctText) },
    ...distractors
      .slice(0, 3)
      .map((d) => ({ id: `d_${rid()}`, title: trimListTitle(d) })),
  ];
  shuffle(allOptions);

  const updatedQuiz: PendingLessonQuiz = {
    ...args.quiz,
    correct_id: correctId,
    options_shuffled: allOptions,
  };
  await patchMemory(args.userId, {
    pending_lesson_quiz: updatedQuiz,
  } as Partial<MemoryJson>);

  const promptText =
    q.mode === "recognition"
      ? `*Pregunta ${qNum}/${total}* 📖\n\nWhat does *"${q.target}"* mean?`
      : `*Pregunta ${qNum}/${total}* ✍️\n\nHow do you say *"${q.native}"* in Spanish?`;

  if (allOptions.length <= 3) {
    // 3-option MCQ → buttons. Tighter UI for the simpler case.
    const buttons = allOptions.map((o) => ({
      id: o.id,
      title: trimTitle(o.title),
    }));
    const result = await sendInteractiveButtons(
      args.whatsappNumber,
      promptText,
      buttons,
    );
    if (result.error) {
      await sendFallback(args.whatsappNumber, promptText, allOptions);
    }
  } else {
    // 4+ options → list. Single section ("Options") since we don't
    // semantically group lesson-quiz options.
    const result = await sendInteractiveList(
      args.whatsappNumber,
      promptText,
      "Choose answer",
      [{ title: "Options", rows: allOptions }],
    );
    if (result.error) {
      await sendFallback(args.whatsappNumber, promptText, allOptions);
    }
  }

  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[lesson quiz ${qNum}/${total} ${q.mode}] ${q.target} ↔ ${q.native}`,
  });
}

async function sendFallback(
  whatsappNumber: string,
  promptText: string,
  options: { id: string; title: string }[],
): Promise<void> {
  const numbered = options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
  await sendText(
    whatsappNumber,
    `${promptText}\n\n${numbered}\n\n(reply with the number)`,
  );
}

// ── Inbound handlers ──────────────────────────────────────────────

interface HandleAnswerArgs {
  userId: string;
  whatsappNumber: string;
  buttonReplyId: string | null;
  textFallback: string | null;
  userPlan: Plan;
  teacherId: string | null;
}

export async function handleLessonQuizAnswer(
  args: HandleAnswerArgs,
): Promise<void> {
  // Quit intent first.
  if (args.textFallback && matchQuitIntent(args.textFallback)) {
    await handleQuitIntent(args.userId, args.whatsappNumber);
    return;
  }

  const memory = await getMemory(args.userId);
  const quiz = (memory as { pending_lesson_quiz?: PendingLessonQuiz })
    .pending_lesson_quiz;
  if (!quiz) {
    await sendText(
      args.whatsappNumber,
      "🌿 Looks like the quiz isn't open anymore. Tell me *next lesson* to keep moving.",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  const q = quiz.questions[quiz.idx];
  if (q.mode === "speaking") {
    // Student sent text on a speaking question — gently redirect.
    await sendText(
      args.whatsappNumber,
      `*Pregunta ${quiz.idx + 1}/${quiz.questions.length}* 🎤\n\nThis one needs a voice note — send me your spoken answer for *"${q.native}"*.`,
    );
    return;
  }

  // Resolve which option they picked.
  let pickedId = args.buttonReplyId;
  if (!pickedId && args.textFallback && quiz.options_shuffled) {
    const m = args.textFallback.trim().match(/^([1-7])\b/);
    if (m) {
      const idx = Number.parseInt(m[1], 10) - 1;
      pickedId = quiz.options_shuffled[idx]?.id ?? null;
    }
  }
  const correct = pickedId === quiz.correct_id;
  const correctText = q.mode === "recognition" ? q.native : q.target;
  await gradeAndAdvance({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz,
    correct,
    actualLine: correct ? null : correctText,
    userPlan: args.userPlan,
    teacherId: args.teacherId,
  });
}

interface HandleVoiceArgs {
  userId: string;
  whatsappNumber: string;
  audioMediaId: string;
  userPlan: Plan;
  teacherId: string | null;
}

export async function handleLessonQuizVoice(
  args: HandleVoiceArgs,
): Promise<void> {
  const memory = await getMemory(args.userId);
  const quiz = (memory as { pending_lesson_quiz?: PendingLessonQuiz })
    .pending_lesson_quiz;
  if (!quiz) {
    await sendText(
      args.whatsappNumber,
      "🌿 No quiz running — tell me *next lesson* to start one.",
    );
    return;
  }
  const q = quiz.questions[quiz.idx];
  if (q.mode !== "speaking") {
    await sendText(
      args.whatsappNumber,
      "I wasn't expecting a voice note for this question 🌿 — tap one of the options instead.",
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
    console.error("[lesson-quiz] whisper failed:", err);
    await sendText(args.whatsappNumber, "I couldn't quite hear that 🌿 Try once more?");
    return;
  }

  const correct = fuzzyMatchSpanish(transcription, q.target);
  await gradeAndAdvance({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz,
    correct,
    actualLine: correct
      ? null
      : `${q.target} (you said: "${transcription.trim()}")`,
    userPlan: args.userPlan,
    teacherId: args.teacherId,
  });
}

// ── Grading + advancement ─────────────────────────────────────────

async function gradeAndAdvance(args: {
  userId: string;
  whatsappNumber: string;
  quiz: PendingLessonQuiz;
  correct: boolean;
  actualLine: string | null;
  userPlan: Plan;
  teacherId: string | null;
}): Promise<void> {
  const { quiz } = args;
  const q = quiz.questions[quiz.idx];
  const newScore = quiz.score + (args.correct ? 1 : 0);
  const newIdx = quiz.idx + 1;
  const newResults = [
    ...quiz.per_item_results,
    { target: q.target, native: q.native, correct: args.correct },
  ];

  const feedback = args.correct
    ? `¡Sí! 🌿 (${newScore}/${newIdx})`
    : `Casi — la respuesta era *${args.actualLine}* 🌿 (${newScore}/${newIdx})`;
  await sendText(args.whatsappNumber, feedback);

  if (newIdx >= quiz.questions.length) {
    await finishQuiz({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      quiz: {
        ...quiz,
        idx: newIdx,
        score: newScore,
        per_item_results: newResults,
      },
      teacherId: args.teacherId,
    });
    return;
  }

  const updated: PendingLessonQuiz = {
    ...quiz,
    idx: newIdx,
    score: newScore,
    per_item_results: newResults,
    correct_id: undefined,
    options_shuffled: undefined,
  };
  await patchMemory(args.userId, {
    pending_lesson_quiz: updated,
  } as Partial<MemoryJson>);

  await sendNextLessonQuestion({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    quiz: updated,
  });
}

async function finishQuiz(args: {
  userId: string;
  whatsappNumber: string;
  quiz: PendingLessonQuiz;
  teacherId: string | null;
}): Promise<void> {
  const score = args.quiz.score;
  const total = args.quiz.questions.length;
  const fraction = score / total;
  const passed = fraction >= PASS_FRACTION;

  // Write per-item results into memory.language_progress. Correct
  // items go to strong_points, wrong to repeated_mistakes (which
  // Phase 2 spaced review will read from).
  const memory = await getMemory(args.userId);
  const lp = memory.language_progress ?? {};
  const strong = Array.isArray(lp.strong_points) ? [...lp.strong_points] : [];
  const wrong = Array.isArray(lp.repeated_mistakes)
    ? [...lp.repeated_mistakes]
    : [];
  for (const r of args.quiz.per_item_results) {
    const tag = `${r.target} ↔ ${r.native}`;
    if (r.correct) strong.push(tag);
    else wrong.push(tag);
  }
  await patchMemory(args.userId, {
    pending_lesson_practice: undefined,
    pending_lesson_quiz: undefined,
    language_progress: {
      ...lp,
      strong_points: strong.slice(-100),
      repeated_mistakes: wrong.slice(-100),
    },
  } as Partial<MemoryJson>);

  // Mark the lesson complete + close out.
  await markLessonComplete(args.userId, args.quiz.lesson_id);
  await updateState(args.userId, { state: "active_free_chat" });

  const headline = passed
    ? `🎉 ${score}/${total} — bien hecho! Lesson *${args.quiz.lesson_title}* complete.`
    : `🌿 ${score}/${total} — we'll revisit some of these in future practice. Lesson *${args.quiz.lesson_title}* complete.`;
  await sendText(args.whatsappNumber, headline);

  // If finishing this lesson just closed out a module, offer the
  // checkpoint quiz before suggesting "next lesson".
  const done = await checkModuleCompletion(args.userId);
  if (done) {
    await offerCheckpointQuiz({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      moduleIdx: done.moduleIdx,
      moduleName: done.moduleName,
      level: done.level,
    });
    return;
  }

  await sendText(
    args.whatsappNumber,
    `Tell me *next lesson* whenever you're ready to keep going.`,
  );
}

// Module-checkpoint helper for the early-exit branch when there are
// no quiz-able items in a lesson.
async function maybeOfferModuleCheckpoint(args: {
  userId: string;
  whatsappNumber: string;
}): Promise<void> {
  try {
    const done = await checkModuleCompletion(args.userId);
    if (done) {
      await offerCheckpointQuiz({
        userId: args.userId,
        whatsappNumber: args.whatsappNumber,
        moduleIdx: done.moduleIdx,
        moduleName: done.moduleName,
        level: done.level,
      });
    }
  } catch (err) {
    console.error("[lesson-quiz] maybeOfferModuleCheckpoint failed:", err);
  }
}

// ── Quit + recovery ───────────────────────────────────────────────

const QUIT_RE = /^\s*(skip|quit|stop( quiz| practice)?|pause|dejar|saltar|paso|no gracias)\b/i;

export function matchQuitIntent(message: string): boolean {
  return QUIT_RE.test(message);
}

export async function handleQuitIntent(
  userId: string,
  whatsappNumber: string,
): Promise<void> {
  await patchMemory(userId, {
    pending_lesson_practice: undefined,
    pending_lesson_quiz: undefined,
  } as Partial<MemoryJson>);
  await updateState(userId, { state: "active_free_chat" });
  await sendText(
    whatsappNumber,
    "🌿 Pausamos — your progress is saved. Tell me *next lesson* whenever you're ready.",
  );
}

// Stale-state recovery — called from route-message when a pending
// lesson_practice/quiz hasn't been touched in 24h. Avoids trapping
// a returning student in a state that no longer makes sense.
export async function clearStaleLessonState(
  userId: string,
  whatsappNumber: string,
): Promise<void> {
  await patchMemory(userId, {
    pending_lesson_practice: undefined,
    pending_lesson_quiz: undefined,
  } as Partial<MemoryJson>);
  await updateState(userId, { state: "active_free_chat" });
  await sendText(
    whatsappNumber,
    "🌿 Looks like we got interrupted earlier. Tell me *next lesson* to keep moving.",
  );
}
