// Pop-quiz handler. Sends multiple-choice quizzes via WhatsApp's
// interactive button messages (up to 3 options) and grades the
// student's reply.
//
// Flow:
//   1. Student says "quiz me" / "test me" / "pop quiz"
//   2. sendQuiz() picks a random item from a completed lesson,
//      generates 2 distractors via GPT, sends interactive buttons,
//      stores the correct answer in memory_json.pending_quiz
//   3. Student taps a button → webhook → handleQuizAnswer()
//   4. Grade, update memory.language_progress, reply with
//      reaction + the correct answer if they got it wrong
//
// We use the existing `pending_phrase` column to store the correct
// button id (keeps the schema flat), and `memory_json.pending_quiz`
// for the rest of the structured data.

import { sendText, sendInteractiveButtons } from "@/lib/messaging/whatsapp";
import { chatCompletion } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { logMessage } from "@/lib/handlers/messages";
import type { LessonContent, LessonItem, MemoryJson, Plan } from "@/types";

interface QuizState {
  question: string;
  options: { id: string; title: string }[];
  correct_id: string;
  correct_answer: string;
  lesson_id?: string;
  item_target: string;
  item_native: string;
  attempts?: number;
}

interface SendQuizArgs {
  userId: string;
  whatsappNumber: string;
  userPlan: Plan;
}

// Generate + send a single quiz. Best-effort — if no source material
// or the GPT distractor call fails, falls back to a friendly text.
export async function sendQuiz(args: SendQuizArgs): Promise<void> {
  const memory = await getMemory(args.userId);

  // Pick a random item from a completed lesson at the student's level
  // (or current lesson, if no completions yet — we still want quizzes
  // to be useful even at lesson 1).
  const sourceItem = await pickQuizSource(args.userId, memory);
  if (!sourceItem) {
    await sendText(
      args.whatsappNumber,
      "We haven't covered enough yet for a quiz 🌿 Tell me *next lesson* and we'll get started.",
    );
    return;
  }

  const { item, lessonId } = sourceItem;

  // Build the quiz body. Two formats — randomly pick:
  //   A) "What does '{spanish}' mean?" with English options
  //   B) "How do you say '{english}' in Spanish?" with Spanish options
  // B is harder; A is recognition. Alternate so students see both.
  const recognitionMode = Math.random() < 0.5;
  const promptBody = recognitionMode
    ? `What does "${item.target_language}" mean? 🌿`
    : `¿Cómo se dice "${item.native_language}" en español? 🌿`;
  const correctTitle = recognitionMode
    ? item.native_language
    : item.target_language;

  // Generate 2 distractors via GPT. Cap each at 18 chars to leave
  // room for WhatsApp's 20-char button title limit. If GPT fails,
  // we abort the quiz rather than send a 1-option button message.
  let distractors: string[];
  try {
    distractors = await generateDistractors({
      correctTarget: item.target_language,
      correctNative: item.native_language,
      recognitionMode,
    });
  } catch (err) {
    console.error("[quiz] distractor generation failed:", err);
    await sendText(
      args.whatsappNumber,
      "Quiz generator is napping 🌿 Try again in a sec.",
    );
    return;
  }

  // Shuffle the three options and pick which one is the correct id.
  const correctId = `correct_${Math.random().toString(36).slice(2, 8)}`;
  const options = [
    { id: correctId, title: trimTitle(correctTitle) },
    { id: `d1_${Math.random().toString(36).slice(2, 8)}`, title: trimTitle(distractors[0]) },
    { id: `d2_${Math.random().toString(36).slice(2, 8)}`, title: trimTitle(distractors[1]) },
  ];
  shuffle(options);

  // Persist the quiz state so the inbound handler can grade.
  const quizState: QuizState = {
    question: promptBody,
    options,
    correct_id: correctId,
    correct_answer: correctTitle,
    lesson_id: lessonId ?? undefined,
    item_target: item.target_language,
    item_native: item.native_language,
    attempts: 0,
  };
  await patchMemory(args.userId, {
    pending_quiz: quizState,
  } as Partial<MemoryJson>);
  await updateState(args.userId, {
    state: "awaiting_quiz_answer",
    pending_phrase: correctId,
  });

  // Send the interactive buttons.
  const result = await sendInteractiveButtons(
    args.whatsappNumber,
    promptBody,
    options,
  );
  if (result.error) {
    console.error("[quiz] sendInteractiveButtons failed:", result.error);
    await sendText(
      args.whatsappNumber,
      `Quiz: ${promptBody}\n\n1. ${options[0].title}\n2. ${options[1].title}\n3. ${options[2].title}\n\n(reply 1, 2, or 3)`,
    );
  }

  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[quiz] ${promptBody}\nOptions: ${options.map((o) => o.title).join(" | ")}\nCorrect: ${correctTitle}`,
  });
}

// Inbound: student tapped a button (or replied with 1/2/3 if the
// interactive fallback fired). Grade + respond + clear state.
interface HandleQuizAnswerArgs {
  userId: string;
  whatsappNumber: string;
  buttonReplyId: string | null;
  buttonReplyTitle: string | null;
  textFallback?: string | null;
  userPlan: Plan;
  teacherId: string | null;
}
export async function handleQuizAnswer(
  args: HandleQuizAnswerArgs,
): Promise<void> {
  const memory = await getMemory(args.userId);
  const quiz = (memory as { pending_quiz?: QuizState }).pending_quiz;
  if (!quiz) {
    // No quiz pending — clear state and pretend it's a regular text turn.
    await updateState(args.userId, {
      state: "active_free_chat",
      pending_phrase: null,
    });
    await sendText(
      args.whatsappNumber,
      "I don't have a quiz running 🌿 Tell me *quiz me* if you want one.",
    );
    return;
  }

  // Resolve which option the student picked. Prefer the button id;
  // fall back to "1"/"2"/"3" text replies when the interactive
  // payload couldn't be delivered.
  let pickedId: string | null = args.buttonReplyId;
  if (!pickedId && args.textFallback) {
    const m = args.textFallback.trim().match(/^([123])\b/);
    if (m) {
      const idx = Number.parseInt(m[1], 10) - 1;
      pickedId = quiz.options[idx]?.id ?? null;
    }
  }

  const correct = pickedId === quiz.correct_id;
  const pickedTitle =
    args.buttonReplyTitle ??
    quiz.options.find((o) => o.id === pickedId)?.title ??
    "(unknown)";

  // Update memory.language_progress with a tiny grade record.
  const lp = (memory.language_progress ?? {}) as MemoryJson["language_progress"];
  const correctList = Array.isArray(lp?.strong_points) ? [...lp!.strong_points!] : [];
  const wrongList = Array.isArray(lp?.repeated_mistakes) ? [...lp!.repeated_mistakes!] : [];
  const tag = `${quiz.item_target} ↔ ${quiz.item_native}`;
  if (correct) correctList.push(tag);
  else wrongList.push(tag);
  await patchMemory(args.userId, {
    pending_quiz: undefined,
    language_progress: {
      ...(lp ?? {}),
      strong_points: correctList.slice(-50),
      repeated_mistakes: wrongList.slice(-50),
    },
  } as Partial<MemoryJson>);

  await updateState(args.userId, {
    state: "active_free_chat",
    pending_phrase: null,
  });

  // Send feedback. Warm + Spanish-first for correct; encouraging
  // for wrong. Don't bury the correct answer when they miss it.
  const reply = correct
    ? `¡Sí, eso es! 🌿 "${quiz.item_target}" = "${quiz.item_native}". ¡Bien hecho!`
    : `Casi 🌿 The right one was *${quiz.correct_answer}* — "${quiz.item_target}" = "${quiz.item_native}". Repítelo en tu cabeza un par de veces.`;
  await sendText(args.whatsappNumber, reply);

  await logMessage({
    userId: args.userId,
    role: "user",
    content: `[quiz answer] ${pickedTitle}${correct ? " ✓" : " ✗"}`,
  });
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: reply,
  });
}

// ── Internals ─────────────────────────────────────────────────────

async function pickQuizSource(
  userId: string,
  memory: MemoryJson,
): Promise<{ item: LessonItem; lessonId: string | null } | null> {
  const sb = getAdminClient();
  const level = memory.level ?? "beginner";

  // Prefer completed lessons (proves the student has been exposed
  // to the content). If none yet, fall back to the current lesson.
  const { data: completed } = await sb
    .from("user_lesson_progress")
    .select("lesson_id, lessons!inner(content)")
    .eq("user_id", userId)
    .eq("status", "completed");

  let candidates: { id: string; content: LessonContent }[] = (completed ?? [])
    .map((row) => {
      // supabase-js types are loose for joined tables — runtime is fine.
      const r = row as unknown as {
        lesson_id: string;
        lessons: { content: LessonContent };
      };
      return r.lessons ? { id: r.lesson_id, content: r.lessons.content } : null;
    })
    .filter((x): x is { id: string; content: LessonContent } => !!x);

  if (candidates.length === 0) {
    const pos = memory.curriculum_position;
    if (pos?.current_topic && pos.current_lesson) {
      const { data: cur } = await sb
        .from("lessons")
        .select("id, content")
        .eq("language", "Spanish")
        .eq("level", level)
        .eq("topic", pos.current_topic)
        .eq("lesson_number", pos.current_lesson)
        .maybeSingle();
      if (cur) candidates = [{ id: cur.id, content: cur.content as LessonContent }];
    }
  }

  if (candidates.length === 0) return null;

  // Pick a random lesson, then a random suitable item from it.
  const lesson = candidates[Math.floor(Math.random() * candidates.length)];
  const items = (lesson.content.items ?? []).filter(
    (i) =>
      (i.type === "vocabulary" || i.type === "phrase") &&
      i.target_language &&
      i.native_language &&
      i.target_language.length <= 18 &&
      i.native_language.length <= 18,
  );
  if (items.length === 0) return null;
  const item = items[Math.floor(Math.random() * items.length)];
  return { item, lessonId: lesson.id };
}

async function generateDistractors(args: {
  correctTarget: string;
  correctNative: string;
  recognitionMode: boolean;
}): Promise<string[]> {
  const system = `You generate plausible-but-wrong multiple-choice options for a Spanish language quiz. Output JSON: {"options":["opt1","opt2"]}. Each option ≤18 characters. Must be plausibly tempting but clearly wrong to a learner who knows the right answer. No accents missing. No quotes inside the options.`;
  const userPrompt = args.recognitionMode
    ? `Spanish word: "${args.correctTarget}" — its correct English meaning is "${args.correctNative}". Give 2 wrong English meanings that a beginner might guess.`
    : `English meaning: "${args.correctNative}" — the correct Spanish is "${args.correctTarget}". Give 2 wrong Spanish words a beginner might confuse with the correct answer.`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    {
      temperature: 0.7,
      max_tokens: 80,
      response_format: { type: "json_object" },
    },
  );
  const parsed = JSON.parse(raw) as { options?: string[] };
  const opts = (parsed.options ?? [])
    .map((s) => String(s).slice(0, 18).trim())
    .filter((s) => s.length > 0);
  if (opts.length < 2) {
    throw new Error(`got ${opts.length} distractors, expected 2`);
  }
  return opts.slice(0, 2);
}

function trimTitle(s: string): string {
  // Meta hard-caps button titles at 20 chars. Trim to 18 to give
  // ourselves headroom in case the source string has invisible
  // characters that count.
  return s.length <= 18 ? s : s.slice(0, 17) + "…";
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
